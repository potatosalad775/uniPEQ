// Adapted from modernGraphTool src/lib/services/device-peq-service.svelte.ts and the connect flow
// of components/features/DevicePeq.svelte @ 23ddc4dd: our settings (`autoPushEnabled`, its delay),
// the status line instead of toasts, and the demo device. It replaces the prototype's
// AutoPushScheduler.
/**
 * Connects, reads, writes and switches the device, and auto-writes, independent of any screen:
 * screens unmount on every tab switch, and a connection (and auto-write) has to outlive them.
 * The screens keep only what needs them: the review dialog and the controls.
 */
import { untrack } from 'svelte';
import type { ConnectResult } from '#lib/device-peq/connect.js';
import { describeDeviceError, errorCode, isConnectionLost } from '#lib/device-peq/errors.js';
import { readRequest } from '#lib/device-peq/preset.js';
import {
	needsConfirmation,
	needsReview,
	planPush,
	readLayout,
	type PushPlan
} from '#lib/device-peq/push-plan.js';
import { controlLabel } from '#lib/device-peq/controls.js';
import { syncStatus, type SyncStatus } from '#lib/device-peq/sync-status.js';
import type { DeviceCandidate, DeviceConnection } from '#lib/device-peq/types.js';
import { sameUsb, usbIdentities } from '#lib/device-peq/usb-identities.js';
import { derivePreamp } from '#lib/eq/eq-preamp.js';
import { fromCapsFilter, type EqFilter } from '#lib/eq/model.js';
import { headroomPreamp } from '#lib/eq/preamp-control.js';
import * as m from '#lib/paraglide/messages.js';
import { appState } from '#lib/platform/app-state.svelte.js';
import { environment } from '#lib/platform/environment.js';
import { hapticError, hapticTick } from '#lib/platform/haptics.js';
import { isNative } from '#lib/platform/native.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { noticeStore } from '#lib/stores/notice-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import {
	DeviceIo,
	type DeviceIoPlugin,
	type NativeUsbDevice
} from '#lib/transports/native/device-io.js';
import type { Filter } from '@potatosalad775/eqcaps-core';
import { logger } from './logger';

export type ConnectKind = 'hid' | 'serial' | 'ble' | 'demo';

/** USB HID: the DeviceIo plugin on Android, WebHID in Chrome and Edge. */
export const canConnectUsb = environment === 'supported';

type Choice = Extract<ConnectResult, { kind: 'choose' }>;

/** The status line while a restarting device is waited for, once it is back, and if it isn't. */
interface RestartMessages {
	waiting: string;
	back: string;
	manual: string;
}

/** What the auto-writer last saw, to tell an edit from a reconnect or a toggle. */
type Seen = { filters: EqFilter[]; preamp: number; conn: DeviceConnection | null };

/**
 * How long a device that restarts to save gets to come back before Reconnect is offered, ms: a
 * USB re-enumeration takes a second or two, and a grant the browser dropped never comes back.
 */
const RESTART_WAIT_MS = 5000;

/**
 * In the browser, how long a device restarting for a control gets to reopen on its own before the
 * chooser opens, ms. A device that keeps its HID handle (the DS3's game mode) is back by then; one
 * whose grant the browser dropped never is, and the chooser needs the confirming click's user
 * activation, which lasts about 5 s.
 */
const CHOOSER_AFTER_MS = 1500;

/** Whether the page may still open a chooser from the last click; true where it can't tell. */
const canChoose = () =>
	(navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ??
	true;

const loadConnect = () => import('#lib/device-peq/connect.js');

/**
 * A read preamp in the list: Auto where the device holds what Auto would write, so it keeps
 * following the bands (and no edit can make the EQ louder than the source); else the device's own
 * value, fixed, since the device's EQ is the document. A device that reports none keeps the list's.
 */
function readPreamp(filters: EqFilter[], preamp: number | undefined): number | 'auto' | undefined {
	if (preamp === undefined) return undefined;
	const derived = derivePreamp(filters);
	const auto = headroomPreamp(derived, eqConstraintStore.preamp);
	return Math.abs(preamp - auto) < 0.01 || Math.abs(preamp - derived) < 0.01 ? 'auto' : preamp;
}

/**
 * The preset the device plays and, where its EQ switch is its own state, whether that is on. A
 * failed read is unknown rather than an error: the connection works without it.
 */
async function playing(conn: DeviceConnection) {
	const slot = await conn.device.currentSlot().catch(() => null);
	const enabled = conn.device.capabilities.readsEnabled
		? await conn.device.eqEnabled().catch(() => null)
		: null;
	return { slot, enabled };
}

class DevicePeqService {
	/** A connect attempt waiting for the user to pick a profile or (Android) a device. */
	choice = $state.raw<{ candidates: DeviceCandidate[] } | null>(null);
	/** Why the last connect attempt found nothing to drive, until the next one. */
	notFound = $state<'unsupported' | 'no-device' | null>(null);

	/** A write waiting for the user to confirm what doesn't fit (the review dialog shows it). */
	review = $state.raw<PushPlan | null>(null);
	/** The list `review` was planned from. */
	#reviewed: { filters: EqFilter[]; preamp: number } | null = null;

	#choice: Choice | null = null;
	#installed = false;
	#watchingUsb = false;
	#unwatchLost: () => void = () => {};
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = false;
	#again = false;
	#seen: Seen | null = null;
	#asking = $state(false);
	/** What the user asked for when the volume warning came up, run once they go on. */
	#afterConsent: (() => Promise<void>) | null = null;

	/** The auto-write switch: the saved setting, unless a failed write stopped it on this connection. */
	get autoWriteOn(): boolean {
		return settingsStore.autoPushEnabled && !devicePeqStore.autoStopped;
	}

	/**
	 * Auto-write is on, and this device can take it. A device that drops the connection to save
	 * is written only with the Write button (manual-save mode): one reconnect per edit is no use.
	 */
	get autoWriting(): boolean {
		const caps = devicePeqStore.connection?.device.capabilities;
		return this.autoWriteOn && !!caps?.canWrite && !caps.disconnectOnSave;
	}

	/**
	 * Writes to this device wait for the volume warning: a write can pop, drop out or jump in level
	 * while audio plays, so the user is asked to pause or lower it once per connection. The demo
	 * device plays nothing.
	 */
	get needsConsent(): boolean {
		const conn = devicePeqStore.connection;
		return (
			!!conn &&
			conn.profileSource !== 'demo' &&
			settingsStore.writeWarning &&
			!devicePeqStore.writeConsent
		);
	}

	/** The volume warning is up; nothing is written until it is answered (`answerVolumeWarning`). */
	get volumeWarning(): boolean {
		return this.#asking && this.needsConsent;
	}

	/** What the sync bar and the device chip show; null before any device. */
	get sync(): SyncStatus | null {
		const store = devicePeqStore;
		const caps = store.connection?.device.capabilities;
		// Device EQ shows a built-in preset: Write is off by design, not because of where it is.
		const builtIn = !!caps?.canWrite && !store.targetWritable;
		return syncStatus({
			connected: !!store.connection,
			knownDevice: store.knownDevice?.name ?? null,
			reading: store.isReading,
			writing: store.isWriting,
			needsReconnect: store.needsReconnect,
			reconnecting: store.isConnecting,
			autoDueAt: store.autoDueAt,
			canWrite: !!caps?.canWrite && !!store.writeTarget,
			canRead: !!caps?.canRead && !!store.readTarget,
			unwritten: store.unwritten,
			message: store.statusMessage,
			messageIsError: store.statusIsError,
			autoWriting: this.autoWriting,
			autoPaused: store.autoPaused,
			autoClipRisk: store.autoClipRisk,
			builtIn,
			unreachable:
				(!!caps?.canWrite && !builtIn && !store.writeTarget) ||
				(!!caps?.canRead && !store.readTarget),
			inSync: store.inSync,
			eqOffBy: store.eqOffBy[0] ? controlLabel(store.eqOffBy[0]) : null
		});
	}

	/** Load the connect module and the device database before a click needs them. */
	warmUp(): void {
		void loadConnect().then((mod) => mod.warmUp());
	}

	/** Report a failed operation in the status line. `note` says what else it caused. */
	fail(error: unknown, op: string, note?: string): void {
		logger.error(`device ${op} failed:`, error instanceof Error ? error.message : String(error));
		const message = describeDeviceError(error);
		devicePeqStore.setStatus(note ? `${message} ${note}` : message, true);
		devicePeqStore.failure = { op, code: errorCode(error) };
		if (isConnectionLost(error) && devicePeqStore.connection) devicePeqStore.needsReconnect = true;
	}

	// ── Connecting ────────────────────────────────────────────────────────────

	/**
	 * USB HID goes through the DeviceIo plugin on Android, the browser's chooser elsewhere. The
	 * demo device is simulated, on every platform.
	 */
	async connect(kind: ConnectKind): Promise<void> {
		await this.#run(async () => {
			const mod = await loadConnect();
			if (kind === 'demo') return mod.connectDemo();
			if (kind === 'hid') return isNative ? mod.connectNativeHid() : mod.connectHid();
			return kind === 'serial' ? mod.connectSerial() : mod.connectBle();
		});
	}

	async choose(id: string): Promise<void> {
		const pending = this.#choice;
		if (!pending) return;
		await this.#run(() => pending.finish(id));
	}

	async cancelChoice(): Promise<void> {
		const pending = this.#choice;
		this.#setChoice(null);
		await pending?.cancel();
	}

	async #run(attempt: () => Promise<ConnectResult>): Promise<void> {
		this.#setChoice(null);
		this.notFound = null;
		devicePeqStore.isConnecting = true;
		devicePeqStore.setStatus(null);
		try {
			const result = await attempt();
			if (result.kind === 'connected') await this.#finishConnect(result.connection);
			else if (result.kind === 'choose') this.#setChoice(result);
			else if (result.kind === 'unsupported' || result.kind === 'no-device') {
				this.notFound = result.kind;
			}
		} catch (e) {
			this.fail(e, 'connect');
		} finally {
			devicePeqStore.isConnecting = false;
		}
	}

	#setChoice(choice: Choice | null): void {
		this.#choice = choice;
		this.choice = choice ? { candidates: choice.candidates } : null;
	}

	/**
	 * The device's EQ is what the list edits, so a connection starts by reading it,
	 * unless the list holds changes this device never got (the sync bar then offers Write and Read).
	 */
	async #finishConnect(conn: DeviceConnection): Promise<void> {
		const { slot, enabled } = await playing(conn);
		devicePeqStore.setConnected(conn, slot, enabled);
		this.#watchLost(conn);
		this.#dropAsk();
		this.install();
		// Auto-write writes without a press, so its warning comes now, before any edit.
		if (this.autoWriting) this.#ask();
		logger.info(
			`connected ${conn.name} (${conn.profileId ?? conn.profileSource}), slot ${slot}, EQ ${enabled ?? '?'}`
		);
		await this.#readControls(conn);
		if (!devicePeqStore.hasUnwritten) await this.read(true);
	}

	/**
	 * The same device, opened again. Its volume warning was answered on this connection already:
	 * a device that restarts on every save would otherwise ask before every write.
	 */
	async #finishReopen(again: DeviceConnection): Promise<void> {
		const consent = devicePeqStore.writeConsent;
		const { slot, enabled } = await playing(again);
		devicePeqStore.setConnected(again, slot, enabled);
		this.#watchLost(again);
		devicePeqStore.writeConsent = consent;
		logger.info(`reopened ${again.name}, slot ${slot}, EQ ${enabled ?? '?'}`);
		await this.#readControls(again);
		if (!devicePeqStore.hasUnwritten) await this.read(true);
	}

	/**
	 * The device's controls, and its firmware for the device facts: only for a device with controls,
	 * since a firmware read costs a timeout on one that doesn't answer (the bridge reads it once,
	 * and controls that depend on it already have). A failed read leaves them unshown; the EQ works
	 * without them.
	 */
	async #readControls(conn: DeviceConnection): Promise<void> {
		const caps = conn.device.capabilities;
		if (caps.controls.length === 0) return;
		try {
			const values = await conn.device.readControls();
			const firmware = caps.readsFirmware ? await conn.device.firmware() : null;
			if (devicePeqStore.connection !== conn) return;
			devicePeqStore.controlValues = values;
			devicePeqStore.firmware = firmware;
			logger.info(`controls ${JSON.stringify(values)}, firmware ${firmware ?? '?'}`);
		} catch (e) {
			logger.warn('reading the controls failed:', e instanceof Error ? e.message : String(e));
		}
	}

	/**
	 * Set a control the user changed. The others are read again after it, since one can decide
	 * which others exist (the DS3's USB mode). A control that restarts the device (`reconnect`) is
	 * followed by reopening it, as after a save; the panel asks before it.
	 */
	setControl(id: string, value: number): Promise<void> {
		return this.setControls([[id, value]]);
	}

	/**
	 * Set several controls for one change (both channel gains for a balance), in the order given,
	 * then read them all again. A write that restarts the device ends the run.
	 */
	async setControls(changes: [id: string, value: number][]): Promise<void> {
		const conn = devicePeqStore.connection;
		const all = conn?.device.capabilities.controls ?? [];
		if (!conn || changes.length === 0 || devicePeqStore.isBusy) return;
		if (!changes.every(([id]) => all.some((c) => c.id === id))) return;
		let control = all[0];
		devicePeqStore.isControlling = true;
		devicePeqStore.setStatus(null);
		let restarts = false;
		try {
			for (const [id, value] of changes) {
				control = all.find((c) => c.id === id)!;
				restarts = (await conn.device.writeControl(id, value)).reconnect;
				logger.info(`set ${id} to ${value}${restarts ? ', the device restarts' : ''}`);
				if (restarts) break;
			}
			if (!restarts) devicePeqStore.controlValues = await conn.device.readControls();
		} catch (e) {
			this.fail(e, 'control');
			hapticError();
			// Show what the device holds, whatever the write did.
			if (!devicePeqStore.needsReconnect) {
				const values = await conn.device.readControls().catch(() => null);
				if (values && devicePeqStore.connection === conn) devicePeqStore.controlValues = values;
			}
		} finally {
			devicePeqStore.isControlling = false;
		}
		if (!restarts) return;
		// Before the close: the device leaving now is the restart, not an unplug.
		if (devicePeqStore.connection === conn) devicePeqStore.needsReconnect = true;
		await conn.device.close().catch(() => {});
		if (devicePeqStore.connection !== conn) return;
		const name = controlLabel(control);
		// A device without a USB serial number loses its browser grant when it re-enumerates (the
		// DS3 on every USB mode switch), and only the chooser finds it again: in the browser it
		// opens soon, on the click that confirmed the change. Android asks for permission itself.
		const browser = !isNative && conn.connectionType === 'hid';
		await this.#awaitRestart(
			conn,
			{
				waiting: m.device_control_restarting({ control: name }),
				back: m.device_control_restarted({ control: name }),
				manual: browser
					? m.device_control_restart_choose({ control: name })
					: m.device_control_restart_reconnect({ control: name })
			},
			browser ? { timeoutMs: CHOOSER_AFTER_MS, choose: true } : {}
		);
	}

	/**
	 * After the device dropped (or restarted to save): find it again without a chooser. In the
	 * browser, a device back under a USB identity the site was never granted (the DS3 after a USB
	 * mode switch) is only found through the chooser, so a click (`choose`) opens it then.
	 */
	async reconnect({ choose = false } = {}): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		devicePeqStore.isConnecting = true;
		try {
			const again = conn.reopen ? await conn.reopen() : null;
			if (again) await this.#finishReopen(again);
			else if (choose && !isNative && conn.connectionType === 'hid') {
				await this.#viaChooser(conn, m.device_peq_status_reconnect_manual());
			} else {
				devicePeqStore.setDisconnected();
				devicePeqStore.setStatus(m.device_peq_status_reconnect_manual());
			}
		} catch (e) {
			this.fail(e, 'reconnect');
		} finally {
			devicePeqStore.isConnecting = false;
		}
	}

	/**
	 * The browser lost the device's grant: connect it again through the chooser, which needs the
	 * click that led here. Cancelled, the panel offers Connect and `manual` says why.
	 */
	async #viaChooser(conn: DeviceConnection, manual: string): Promise<void> {
		logger.info(`${conn.name} not granted as it is now, asking through the chooser`);
		devicePeqStore.setDisconnected();
		await this.connect('hid');
		if (!devicePeqStore.connection && !this.choice && !this.notFound) {
			devicePeqStore.setStatus(manual);
		}
	}

	// ── Android USB attach and detach ─────────────────────────────────────────

	/** Android: follow the plugin's USB attach and detach events. Once, from the root layout. */
	async watchUsb(plugin: DeviceIoPlugin = DeviceIo): Promise<void> {
		if (this.#watchingUsb) return;
		this.#watchingUsb = true;
		await plugin.addListener(
			'deviceDetached',
			({ deviceName }) => void this.usbDetached(deviceName)
		);
		await plugin.addListener('deviceAttached', ({ device }) => void this.usbAttached(device));
	}

	/** The connected device was unplugged, as the plugin tells it by its path. */
	async usbDetached(deviceName: string): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn || conn.usbDeviceName !== deviceName) return;
		await this.#lost(conn);
	}

	/** Follow `conn` going, where its transport says (the browser's); the last one is dropped. */
	#watchLost(conn: DeviceConnection): void {
		this.#unwatchLost();
		this.#unwatchLost = conn.onLost?.(() => void this.#lost(conn)) ?? (() => {});
	}

	/**
	 * The device went: disconnected now, not at the next failed write, with the list read-only until
	 * it is back. One that restarts to save is expected to go, and kept for its return: it can go
	 * before the write that saved has returned (the FOLA does), so a write under way counts too, as
	 * does a control being set (one can restart the device). Really unplugged then, the write fails
	 * and says so.
	 */
	async #lost(conn: DeviceConnection): Promise<void> {
		if (devicePeqStore.connection !== conn) return;
		const saving = devicePeqStore.isWriting && conn.device.capabilities.disconnectOnSave;
		if (devicePeqStore.needsReconnect || saving || devicePeqStore.isControlling) {
			logger.info(`${conn.name} went, waiting to be reconnected`);
			return;
		}
		logger.info(`${conn.name} unplugged`);
		await this.disconnect();
	}

	/**
	 * A device was plugged in. The one waiting to be reconnected is reopened (unless a reopen is
	 * already waiting for it). Else, with nothing connected or connecting and the app in view,
	 * connect, as the device chip would; a device the database can't drive (a keyboard) is left
	 * alone.
	 */
	async usbAttached(device: NativeUsbDevice): Promise<void> {
		const conn = devicePeqStore.connection;
		if (conn && devicePeqStore.needsReconnect && !devicePeqStore.isConnecting) {
			// Back as any identity it has: the DS3's changes with its USB mode.
			const same = usbIdentities(conn.identity.usb, conn.profile).some((i) => sameUsb(i, device));
			if (same) {
				logger.info(`${conn.name} attached again, reconnecting`);
				await this.reconnect();
			}
			return;
		}
		const busy = () => !!devicePeqStore.connection || devicePeqStore.isConnecting || !!this.choice;
		if (busy()) return;
		if (!appState.active) return;
		const mod = await loadConnect();
		if (!(await mod.drivableNative(device)) || busy()) return;
		logger.info(`${device.productName || device.deviceName} plugged in`);
		await this.connect('hid');
	}

	async disconnect(): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		this.#cancelPending();
		this.#dropAsk();
		this.#unwatchLost();
		this.#unwatchLost = () => {};
		await conn.device.close().catch(() => {});
		devicePeqStore.setDisconnected();
	}

	// ── Reading and writing ───────────────────────────────────────────────────

	/** Replace the band list with what Device EQ shows. */
	/**
	 * Read the preset Device EQ shows into the list. The Read button's read is an undo step; an
	 * automatic one (`fresh`, on connecting or switching presets) starts a new history instead.
	 */
	async read(fresh = false): Promise<void> {
		const conn = devicePeqStore.connection;
		const request = devicePeqStore.readTarget;
		if (!conn || !request) return;
		devicePeqStore.isReading = true;
		try {
			const result = await conn.device.pull(request);
			const bands = result.filters.filter((f) => f !== null);
			const filters = bands.map(fromCapsFilter).filter((f) => f !== null);
			const preamp = readPreamp(filters, result.preamp);
			if (fresh) eqStore.open(filters, preamp);
			else eqStore.replace(filters, preamp);
			devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
			const skipped = bands.length - filters.length;
			devicePeqStore.setStatus(
				skipped > 0
					? `${m.device_peq_status_read({ count: filters.length })}. ${m.device_peq_read_skipped({ count: skipped })}`
					: m.device_peq_status_read({ count: filters.length })
			);
		} catch (e) {
			this.fail(e, 'read');
		} finally {
			devicePeqStore.isReading = false;
		}
	}

	/**
	 * The plan for writing the list as it is now. When it leaves device bands empty, the target
	 * preset is read once first (and kept in `devicePeqStore.layout` until the preset changes), so
	 * those bands keep the device's own layout. Null when the device went away meanwhile.
	 */
	async prepare(): Promise<PushPlan | null> {
		const conn = devicePeqStore.connection;
		if (!conn || !devicePeqStore.writeTarget) return null;
		const caps = conn.device.capabilities;
		const plan = (hints?: (Filter | null)[] | null) =>
			planPush(
				eqStore.filters,
				eqConstraintStore.preampValue,
				conn.profile,
				caps,
				hints ?? undefined
			);
		const first = plan(devicePeqStore.layout?.hints);
		if (first.emptySlots === 0 || devicePeqStore.layout) return first;
		const slot = devicePeqStore.activeSlot;
		devicePeqStore.isWriting = true;
		let hints: (Filter | null)[] | null;
		try {
			hints = await readLayout(conn.device, readRequest(caps, slot, devicePeqStore.deviceSlot));
		} finally {
			devicePeqStore.isWriting = false;
		}
		if (devicePeqStore.connection !== conn) return null;
		if (devicePeqStore.activeSlot === slot) devicePeqStore.layout = { slot, hints };
		return plan(hints);
	}

	/**
	 * The Write button (and the sync bar's Write and Review): straight away when the device holds
	 * the list exactly, else after the user reviews the changes in the dialog (`review`).
	 */
	async requestWrite(): Promise<void> {
		if (this.#ask(() => this.requestWrite())) return;
		const source = { filters: eqStore.filters, preamp: eqStore.preamp };
		const plan = await this.prepare();
		if (!plan) return;
		if (needsConfirmation(plan)) {
			this.review = plan;
			this.#reviewed = source;
		} else await this.write(plan);
	}

	/**
	 * The review's answer: write the plan it showed, or drop it. If the list changed while the
	 * review was up (the modernGraphTool link edits it meanwhile), what's there now is planned
	 * again instead: the plan was for a list no longer on screen.
	 */
	async confirmReview(confirmed: boolean): Promise<void> {
		const plan = this.review;
		const source = this.#reviewed;
		this.review = null;
		this.#reviewed = null;
		if (!confirmed || !plan) return;
		if (source && (source.filters !== eqStore.filters || source.preamp !== eqStore.preamp)) {
			return this.requestWrite();
		}
		await this.write(plan);
	}

	/**
	 * Send `plan` to the preset Device EQ shows. Whether it was written. An automatic write that
	 * fails stops auto-write on this connection.
	 */
	async write(plan: PushPlan, auto = false): Promise<boolean> {
		const conn = devicePeqStore.connection;
		const request = devicePeqStore.writeTarget;
		if (!conn || !request) return false;
		const snapshot = { filters: eqStore.filters, preamp: eqStore.preamp };
		devicePeqStore.isWriting = true;
		try {
			const result = await conn.device.push({
				filters: plan.filters,
				...(plan.preamp !== undefined ? { preamp: plan.preamp } : {}),
				...request
			});
			devicePeqStore.synced = snapshot;
			devicePeqStore.autoPaused = false;
			const count = plan.filters.length - plan.emptySlots;
			if (result.reconnect) {
				// The device restarts to save. Its transport is gone; `reopen` finds it again.
				await conn.device.close().catch(() => {});
				// Unless the user disconnected while it wrote.
				if (devicePeqStore.connection === conn) {
					devicePeqStore.needsReconnect = true;
					void this.#awaitRestart(conn, {
						waiting: m.device_peq_status_saved_reconnecting(),
						back: m.device_peq_status_saved_reconnected({ count }),
						manual: m.device_peq_status_saved_reconnect()
					});
				}
			} else {
				// Written to a listed preset while the device sits on a built-in one: switch to it,
				// so what was written is what plays.
				const slot = devicePeqStore.activeSlot;
				if (
					devicePeqStore.selection === 'other' &&
					conn.device.capabilities.canEnable &&
					slot !== null
				) {
					await conn.device.setEnabled(true, slot);
					devicePeqStore.played(slot);
				}
				devicePeqStore.setStatus(
					devicePeqStore.eqEnabled === false
						? m.device_peq_status_written_off({ count })
						: m.device_peq_status_written({ count })
				);
			}
			logger.info(`wrote ${count} band(s) to ${conn.name}${auto ? ' (auto)' : ''}`);
			hapticTick();
			return true;
		} catch (e) {
			if (auto) devicePeqStore.autoStopped = true;
			this.fail(e, 'write', auto ? m.device_peq_auto_stopped() : undefined);
			hapticError();
			// An automatic write fails while the user looks at something else (the band editor
			// covers the sync bar): say so where they are.
			if (auto && devicePeqStore.statusMessage) noticeStore.say(devicePeqStore.statusMessage, true);
			return false;
		} finally {
			devicePeqStore.isWriting = false;
		}
	}

	/**
	 * A device that restarted (to save, or for a control) is reopened as soon as it is back. Not back
	 * within `timeoutMs`, or no longer granted to the site (which only the chooser, on a click, can
	 * fix), the sync bar offers Reconnect; with `choose`, the chooser opens instead while the click
	 * that started this still allows it. The log says when the device went and came back, and
	 * whether the browser said so, to tell those two apart.
	 */
	async #awaitRestart(
		conn: DeviceConnection,
		say: RestartMessages,
		{ timeoutMs = RESTART_WAIT_MS, choose = false } = {}
	): Promise<void> {
		if (!conn.reopen) {
			devicePeqStore.setStatus(say.manual);
			return;
		}
		const start = performance.now();
		const since = () => Math.round(performance.now() - start);
		const seen: string[] = [];
		devicePeqStore.isConnecting = true;
		devicePeqStore.setStatus(say.waiting);
		let again: DeviceConnection | null = null;
		try {
			again = await conn.reopen({
				timeoutMs,
				onEvent: (event) => seen.push(`${event} at ${since()} ms`)
			});
		} catch (e) {
			logger.warn('reopen after a restart failed:', e instanceof Error ? e.message : String(e));
		}
		const events = seen.length > 0 ? seen.join(', ') : 'no connect or disconnect event';
		// Disconnected meanwhile: what came back is no longer wanted.
		if (devicePeqStore.connection !== conn || !devicePeqStore.needsReconnect) {
			await again?.device.close().catch(() => {});
			// Set by this wait: left on, the connect controls stay disabled.
			if (!devicePeqStore.connection) devicePeqStore.isConnecting = false;
			return;
		}
		if (!again) {
			logger.warn(`${conn.name} not back ${since()} ms after restarting (${events})`);
			devicePeqStore.isConnecting = false;
			if (choose && canChoose()) {
				await this.#viaChooser(conn, say.manual);
				if (devicePeqStore.connection && !devicePeqStore.statusIsError) {
					devicePeqStore.setStatus(say.back);
				}
			} else devicePeqStore.setStatus(say.manual);
			return;
		}
		logger.info(`${conn.name} back ${since()} ms after restarting (${events})`);
		try {
			await this.#finishReopen(again);
			if (!devicePeqStore.statusIsError) devicePeqStore.setStatus(say.back);
		} catch (e) {
			this.fail(e, 'reconnect');
		} finally {
			devicePeqStore.isConnecting = false;
		}
	}

	/**
	 * Switch the device to what Device EQ picked: `p<id>` for a preset, `on`, or `off`. A preset
	 * picked is then read, unless the list holds changes not written yet.
	 */
	async switchTo(value: string): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		// An edit waiting to be auto-written belongs to the preset it was made on.
		this.#cancelPending();
		const slot = value.startsWith('p')
			? Number(value.slice(1))
			: value === 'on'
				? devicePeqStore.slots[0]?.id
				: undefined;
		if (!conn.device.capabilities.canEnable) {
			// Nothing to switch: the control only picks what Read and Write reach.
			if (slot === undefined) return;
			devicePeqStore.target(slot);
			if (!devicePeqStore.hasUnwritten) await this.read(true);
			return;
		}
		// Another preset, or the EQ on or off, changes what plays as much as a write does.
		if (this.#ask(() => this.switchTo(value))) return;
		devicePeqStore.isSwitching = true;
		let switched = false;
		try {
			if (value === 'off') {
				await conn.device.setEnabled(false);
				devicePeqStore.played('off');
			} else {
				await conn.device.setEnabled(true, slot);
				devicePeqStore.played(slot);
				switched = true;
			}
		} catch (e) {
			this.fail(e, 'switch');
		} finally {
			devicePeqStore.isSwitching = false;
		}
		if (switched && !devicePeqStore.hasUnwritten) await this.read(true);
	}

	// ── Auto-write ────────────────────────────────────────────────────────────

	/**
	 * Turn auto-write on or off. On writes the list once, now: from then on the device follows
	 * every change. Off drops an edit still waiting.
	 */
	setAutoWrite(on: boolean): void {
		devicePeqStore.autoStopped = false;
		settingsStore.autoPushEnabled = on;
		if (!on) {
			this.#cancelPending();
			devicePeqStore.autoPaused = false;
			devicePeqStore.autoClipRisk = false;
			return;
		}
		this.install();
		if (this.autoWriting) this.#ask();
		void this.#flush();
	}

	/**
	 * The volume warning's answer. Go on: what was asked for (a Write, a preset switch) runs, and
	 * auto-write writes what waits; `quiet` stops the warning for later connections. Not now:
	 * nothing is written, auto-write is off on this connection (as after a failed write), and the
	 * next Write or switch asks again.
	 */
	async answerVolumeWarning(go: boolean, quiet = false): Promise<void> {
		if (!this.volumeWarning) return;
		const then = this.#afterConsent;
		this.#dropAsk();
		if (!go) {
			this.#cancelPending();
			if (this.autoWriting) devicePeqStore.autoStopped = true;
			return;
		}
		devicePeqStore.writeConsent = true;
		if (quiet) settingsStore.writeWarning = false;
		await then?.();
		await this.#flush();
	}

	/**
	 * Bring up the volume warning if writes to this device need it, keeping `then` to run once the
	 * user goes on. Whether it did: the caller stops there.
	 */
	#ask(then?: () => Promise<void>): boolean {
		if (!this.needsConsent) return false;
		this.#asking = true;
		if (then) this.#afterConsent = then;
		return true;
	}

	#dropAsk(): void {
		this.#asking = false;
		this.#afterConsent = null;
	}

	/**
	 * Auto-write what's waiting now rather than after the delay: the modernGraphTool link's
	 * `settle`, whose message handler is where device work has to run (a timer drifts in Doze, a
	 * message wakes the CPU). Nothing happens unless auto-write is on.
	 */
	async writeNow(): Promise<void> {
		this.#cancelPending();
		await this.#flush();
	}

	/**
	 * Start following the band list. Idempotent; called on connect. The root is never disposed:
	 * it lives as long as the page.
	 */
	install(): void {
		if (this.#installed) return;
		this.#installed = true;
		$effect.root(() => {
			$effect(() => {
				const seen: Seen = {
					filters: eqStore.filters,
					preamp: eqStore.preamp,
					conn: devicePeqStore.connection
				};
				untrack(() => this.#changed(seen));
			});
		});
	}

	#changed(now: Seen): void {
		const before = this.#seen;
		this.#seen = now;
		// A new connection is a new baseline, never an edit: connecting must not write.
		if (!before || before.conn !== now.conn || !now.conn) return this.#cancelPending();
		if (before.filters === now.filters && before.preamp === now.preamp) return;
		if (!this.autoWriting) return;
		this.#cancelPending();
		// Nothing to count down before the volume warning is answered: going on writes.
		if (this.needsConsent) return;
		// A read, or an undo back to what the device has: nothing to write, so nothing to wait for.
		if (devicePeqStore.inSync === true) return;
		this.#schedule();
	}

	#schedule(): void {
		const delay = settingsStore.autoPushDelayMs;
		this.#timer = setTimeout(() => void this.#flush(), delay);
		devicePeqStore.autoDueAt = Date.now() + delay;
	}

	#cancelPending(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		devicePeqStore.autoDueAt = null;
	}

	/** One write at a time; edits made during one are written next, as the list is by then. */
	async #flush(): Promise<void> {
		this.#timer = undefined;
		devicePeqStore.autoDueAt = null;
		if (this.#running) {
			this.#again = true;
			return;
		}
		this.#running = true;
		try {
			do {
				this.#again = false;
				if (!this.autoWriting || devicePeqStore.needsReconnect) return;
				if (this.#ask()) return;
				if (devicePeqStore.isBusy) {
					// A read, a switch or a button write is under way: try again after it.
					this.#schedule();
					return;
				}
				if (devicePeqStore.inSync === true) {
					devicePeqStore.autoPaused = false;
					continue;
				}
				const plan = await this.prepare();
				if (!plan) return;
				devicePeqStore.autoClipRisk = plan.clipRisk;
				if (needsReview(plan)) {
					devicePeqStore.autoPaused = true;
					continue;
				}
				if (!(await this.write(plan, true))) return;
			} while (this.#again);
		} finally {
			this.#running = false;
		}
	}
}

export const devicePeqService = new DevicePeqService();
