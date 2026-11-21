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
import { eqLabel, eqView, type EqTarget } from '#lib/device-peq/device-eqs.js';
import { describeDeviceError, errorCode, isConnectionLost } from '#lib/device-peq/errors.js';
import { currentSlotOf, readRequest, tellsUnsaved } from '#lib/device-peq/preset.js';
import {
	bandsWritten,
	drivesChannelsApart,
	needsConfirmation,
	needsReview,
	planPush,
	readLayout,
	type Layout,
	type PushPlan
} from '#lib/device-peq/push-plan.js';
import {
	balanceLabel,
	balanceOf,
	balanceValue,
	controlLabel,
	controlValueLabel
} from '#lib/device-peq/controls.js';
import { syncStatus, type SyncStatus } from '#lib/device-peq/sync-status.js';
import type { DeviceCandidate, DeviceConnection, DeviceOperation } from '#lib/device-peq/types.js';
import { sameUsb, usbIdentities } from '#lib/device-peq/usb-identities.js';
import { derivePreamp, pregainOf } from '#lib/eq/eq-preamp.js';
import { fromCapsFilter, type EqFilter, type EqLoad, type StereoEq } from '#lib/eq/model.js';
import { headroomPreamp } from '#lib/eq/preamp-control.js';
import * as m from '#lib/paraglide/messages.js';
import { appState } from '#lib/platform/app-state.svelte.js';
import { environment } from '#lib/platform/environment.js';
import { hapticError, hapticTick } from '#lib/platform/haptics.js';
import { isNative } from '#lib/platform/native.js';
import { devicePeqStore, type DeviceSnapshot } from '#lib/stores/device-peq-store.svelte.js';
import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { noticeStore } from '#lib/stores/notice-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import {
	DeviceIo,
	type DeviceIoPlugin,
	type NativeUsbDevice
} from '#lib/transports/native/device-io.js';
import { eqProfile, type Filter } from '@potatosalad775/eqcaps-core';
import type { Slot } from '@potatosalad775/eqcaps-device-bridge';
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
type Seen = { eq: DeviceSnapshot; conn: DeviceConnection | null };

/**
 * Whether two snapshots of the EQ are the same lists and preamps, by identity: the lists are
 * replaced on every edit, never changed in place. Showing the other channel changes neither.
 */
function unchanged(a: DeviceSnapshot, b: DeviceSnapshot): boolean {
	return (
		a.filters === b.filters &&
		a.preamp === b.preamp &&
		a.right?.filters === b.right?.filters &&
		a.right?.preamp === b.right?.preamp
	);
}

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

/** One channel as read: the bands the app edits, and how many it can't (an `x-` type). */
function readBands(held: readonly (Filter | null)[]): { filters: EqFilter[]; skipped: number } {
	const bands = held.filter((f) => f !== null);
	const filters = bands.map(fromCapsFilter).filter((f) => f !== null);
	return { filters, skipped: bands.length - filters.length };
}

/** Whether a device's two channels hold the same bands, as it reports them. */
function sameBands(a: readonly (Filter | null)[], b: readonly (Filter | null)[]): boolean {
	return (
		a.length === b.length &&
		a.every((f, i) => {
			const g = b[i];
			if (f === null || g === null) return f === g;
			return f.type === g.type && f.freq === g.freq && f.q === g.q && f.gain === g.gain;
		})
	);
}

/**
 * The EQ as a write sends it: each channel's list, and its preamp moved onto the device's grid
 * (`preampValueOf`). The right channel only while the channels are apart.
 */
function writtenEq(): StereoEq {
	const { left, right } = eqStore.channels;
	return {
		filters: left.filters,
		preamp: eqConstraintStore.preampValueOf(left),
		...(eqStore.linked
			? {}
			: { right: { filters: right.filters, preamp: eqConstraintStore.preampValueOf(right) } })
	};
}

/**
 * The preset the device plays (`'unsaved'` for none) and, where its EQ switch is its own state,
 * whether that is on. A failed read is unknown rather than an error: the connection works without
 * it. Only an answer can say the device is on no preset.
 */
async function playing(conn: DeviceConnection) {
	const caps = conn.device.capabilities;
	const slot = await conn.device.currentSlot().then(
		(answer) => currentSlotOf(caps, answer),
		() => null
	);
	const enabled = caps.readsEnabled ? await conn.device.eqEnabled().catch(() => null) : null;
	return { slot, enabled };
}

/**
 * The presets a device that keeps a list holds now, under its own names; null for a device whose
 * presets are the profile's, and when the list can't be read (the profile's then stand in).
 */
async function listed(conn: DeviceConnection): Promise<Slot[] | null> {
	if (!conn.device.capabilities.listsSlots || !conn.device.slots) return null;
	return conn.device.slots().then(
		(slots) => [...slots],
		() => null
	);
}

/**
 * Whether listed EQ `id` is there in the device's current mode, asked with a cheap read: a mode
 * that lacks it answers `unsupported` (a Qudelix in single-EQ mode has no headphone EQ). Any other
 * failure is thrown: it says nothing about the EQ.
 */
async function eqThere(conn: DeviceConnection, id: string): Promise<boolean> {
	try {
		await conn.device.eq(id).currentSlot();
		return true;
	} catch (e) {
		if (errorCode(e) === 'unsupported') return false;
		throw e;
	}
}

/**
 * The listed EQs the device's current mode lacks, as connecting finds them. One that fails to
 * answer otherwise stays listed: picking it reports that failure.
 */
async function absentEqs(conn: DeviceConnection): Promise<string[]> {
	const absent: string[] = [];
	for (const { id } of conn.device.capabilities.eqs) {
		const there = await eqThere(conn, id).catch((e) => {
			logger.warn(`asking for EQ ${id} failed:`, e instanceof Error ? e.message : String(e));
			return true;
		});
		if (!there) absent.push(id);
	}
	return absent;
}

/**
 * The band count the device reports for EQ `id` where it differs from the data's, else null
 * (also where the profile sets slots by index, which would no longer line up).
 */
async function reportedBands(conn: DeviceConnection, id: string | undefined) {
	const data = eqProfile(conn.profile, id)!;
	if (!conn.device.capabilities.readsBandCount || data.bands?.length) return null;
	const reported = await conn.device.eq(id).bandCount();
	if (reported === null || reported === data.bandCount) return null;
	logger.warn(`${data.id}: the device reports ${reported} bands, not ${data.bandCount}`);
	return reported;
}

/**
 * EQ `id` of `conn`, read for editing as a connect reads one: the band count the device reports
 * for it where that differs from the data's (unless the profile sets slots by index, which would
 * no longer line up), what it plays and its presets.
 */
async function openEq(conn: DeviceConnection, id: string | undefined) {
	const eq: EqTarget = { id, bandCount: await reportedBands(conn, id) };
	const view = eqView(conn, eq);
	const { slot, enabled } = await playing(view);
	return { eq, view, slot, enabled, slots: await listed(view) };
}

class DevicePeqService {
	/** A connect attempt waiting for the user to pick a profile or (Android) a device. */
	choice = $state.raw<{ candidates: DeviceCandidate[] } | null>(null);
	/** Why the last connect attempt found nothing to drive, until the next one. */
	notFound = $state<'unsupported' | 'no-device' | null>(null);

	/** A write waiting for the user to confirm what doesn't fit (the review dialog shows it). */
	review = $state.raw<PushPlan | null>(null);
	/** The EQ `review` was planned from. */
	#reviewed: DeviceSnapshot | null = null;
	/** What runs once the reviewed write is written. */
	#afterReview: (() => Promise<void>) | null = null;
	/**
	 * Another of the device's EQs was picked while the list holds changes the EQ on screen never
	 * got: the dialog asks whether to write them first (`leaveEq`).
	 */
	eqLeaving = $state.raw<{ to: string | undefined } | null>(null);

	#choice: Choice | null = null;
	#installed = false;
	#watchingUsb = false;
	#unwatchLost: () => void = () => {};
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = false;
	#again = false;
	#seen: Seen | null = null;
	#asking = $state(false);
	/** Settles when the operation under way ends. */
	#operating: Promise<void> = Promise.resolve();
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
			operation: store.operation,
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
			eqOff: store.selection === 'off',
			eqOffBy: store.eqOffBy[0] ? controlLabel(store.eqOffBy[0]) : null
		});
	}

	/** Load the connect module and the device database before a click needs them. */
	warmUp(): void {
		void loadConnect().then((mod) => mod.warmUp());
	}

	/**
	 * Run one device operation. One at a time: with another under way this one isn't started, and
	 * undefined comes back, as it does when `work` throws. The sync bar names it while it runs, and
	 * the last operation's line goes as it starts, so the bar never describes an older one after it.
	 * A throw goes to `failed`, which says it in the status line.
	 */
	async #operate<T>(
		op: DeviceOperation,
		work: () => Promise<T>,
		failed: (error: unknown) => void | Promise<void> = (e) => this.fail(e, op)
	): Promise<T | undefined> {
		if (devicePeqStore.operation !== null) return undefined;
		let done = () => {};
		this.#operating = new Promise((resolve) => (done = resolve));
		devicePeqStore.operation = op;
		devicePeqStore.setStatus(null);
		try {
			return await work();
		} catch (e) {
			await failed(e);
			return undefined;
		} finally {
			devicePeqStore.operation = null;
			done();
		}
	}

	/** Report a failed operation in the status line. `note` says what else it caused. */
	fail(error: unknown, op: string, note?: string): void {
		logger.error(`device ${op} failed:`, error instanceof Error ? error.message : String(error));
		const message = describeDeviceError(error);
		devicePeqStore.setStatus(note ? `${message} ${note}` : message, true);
		devicePeqStore.failure = { op, code: errorCode(error) };
		if (isConnectionLost(error) && devicePeqStore.connection) devicePeqStore.needsReconnect = true;
		// The device may have left the mode that has this EQ.
		if (errorCode(error) === 'unsupported' && devicePeqStore.eq !== undefined) {
			void this.#checkEq();
		}
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
	 * A device with several EQs starts on the profile's own, every time.
	 */
	async #finishConnect(conn: DeviceConnection): Promise<void> {
		const absent = await absentEqs(conn);
		const { eq, view, slot, enabled, slots } = await openEq(conn, undefined);
		const linked = this.#linkFor(view);
		devicePeqStore.setConnected(conn, slot, enabled, slots, eq, absent);
		if (linked) devicePeqStore.setStatus(m.eq_channels_linked_for({ device: conn.name }));
		this.#watchLost(conn);
		this.#dropAsk();
		this.install();
		// Auto-write writes without a press, so its warning comes now, before any edit.
		if (this.autoWriting) this.#ask();
		const lacks = absent.length > 0 ? `, without EQ ${absent.join(', ')}` : '';
		logger.info(
			`connected ${conn.name} (${conn.profileId ?? conn.profileSource}), slot ${slot}, EQ ${enabled ?? '?'}${lacks}`
		);
		await this.#readControls(conn);
		if (!devicePeqStore.hasUnwritten) await this.read(true);
	}

	/**
	 * The channels may be apart only for an EQ that drives them apart. Apart when another device
	 * or EQ is opened, they become the left channel for both, as a fresh start: an undo would set
	 * them apart again on an EQ that can't hold that. Whether it did, for the status line to say
	 * so; a read that follows replaces the list anyway, as it does for any other device's.
	 */
	#linkFor(conn: DeviceConnection): boolean {
		if (eqStore.linked || drivesChannelsApart(conn.profile, conn.device.capabilities)) return false;
		const { left } = eqStore.channels;
		eqStore.open({ filters: left.filters, preamp: pregainOf(left) });
		logger.info(`${conn.name} has one EQ for both channels: kept the left channel`);
		return true;
	}

	/**
	 * The same device, opened again, on the same EQ while its mode still has it. Its volume warning
	 * was answered on this connection already: a device that restarts on every save would otherwise
	 * ask before every write.
	 */
	async #finishReopen(again: DeviceConnection): Promise<void> {
		const consent = devicePeqStore.writeConsent;
		const was = devicePeqStore.eq;
		const absent = await absentEqs(again);
		const kept =
			was !== undefined &&
			!absent.includes(was) &&
			again.device.capabilities.eqs.some((e) => e.id === was);
		const { eq, slot, enabled, slots } = await openEq(again, kept ? was : undefined);
		devicePeqStore.setConnected(again, slot, enabled, slots, eq, absent);
		this.#watchLost(again);
		devicePeqStore.writeConsent = consent;
		const on = was !== undefined && !kept ? `, EQ ${was} gone` : '';
		logger.info(`reopened ${again.name}, slot ${slot}, EQ ${enabled ?? '?'}${on}`);
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
			if (devicePeqStore.opened !== conn) return;
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
		let restarts = false;
		await this.#operate(
			'control',
			async () => {
				for (const [id, value] of changes) {
					control = all.find((c) => c.id === id)!;
					restarts = (await conn.device.writeControl(id, value)).reconnect;
					logger.info(`set ${id} to ${value}${restarts ? ', the device restarts' : ''}`);
					if (restarts) break;
				}
				if (!restarts) {
					devicePeqStore.controlValues = await conn.device.readControls();
					devicePeqStore.setStatus(this.#controlSet(changes));
				}
			},
			async (e) => {
				this.fail(e, 'control');
				hapticError();
				// Show what the device holds, whatever the write did.
				if (!devicePeqStore.needsReconnect) {
					const values = await conn.device.readControls().catch(() => null);
					if (values && devicePeqStore.connection === conn) devicePeqStore.controlValues = values;
				}
			}
		);
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
	 * What a control write did, as the device now holds it: the balance as one value when the
	 * changes were its two gains, else the last control changed.
	 */
	#controlSet(changes: [id: string, value: number][]): string {
		const values = devicePeqStore.controlValues;
		const balance = balanceOf(devicePeqStore.controls);
		if (balance && changes.some(([id]) => id === balance.left.id || id === balance.right.id)) {
			const value = balanceLabel(balance, balanceValue(balance, values));
			return m.device_control_set({ control: m.device_control_balance(), value });
		}
		const [id, wrote] = changes[changes.length - 1];
		const control = devicePeqStore.connection!.device.capabilities.controls.find(
			(c) => c.id === id
		)!;
		const value = controlValueLabel(control, values[id] ?? wrote);
		return m.device_control_set({ control: controlLabel(control), value });
	}

	/**
	 * After the device dropped (or restarted to save): find it again without a chooser. In the
	 * browser, a device back under a USB identity the site was never granted (the DS3 after a USB
	 * mode switch) is only found through the chooser, so a click (`choose`) opens it then.
	 */
	async reconnect({ choose = false } = {}): Promise<void> {
		const conn = devicePeqStore.connection;
		// Already being looked for (a restart awaited, or an earlier press): a second search that
		// finds nothing would drop the device the first is about to reopen.
		if (!conn || devicePeqStore.isConnecting) return;
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
		const conn = devicePeqStore.opened;
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
		if (devicePeqStore.opened !== conn) return;
		const op = devicePeqStore.operation;
		const saving = op === 'write' && conn.device.capabilities.disconnectOnSave;
		if (devicePeqStore.needsReconnect || saving || op === 'control') {
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

	/**
	 * Read the preset Device EQ shows into the list. The Read button's read is an undo step; an
	 * automatic one (`fresh`, on connecting or switching presets) starts a new history instead.
	 * A device that drives its channels apart opens apart exactly when its channels differ (bands or
	 * preamp); otherwise, and on every other device, one list for both. `note` goes before what the
	 * status line says of the read.
	 */
	async read(fresh = false, note?: string): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		// The Read button also asks which EQs the device has now: its mode may have moved.
		if (!fresh && (await this.#modeMoved())) return;
		if (devicePeqStore.connection !== conn || !devicePeqStore.readTarget) return;
		await this.#operate('read', async () => {
			// The Read button reads where the device is now. One whose EQ can be on no preset leaves
			// its preset on any edit, its own app's included, so it is asked first and Device EQ
			// follows it. An automatic read comes just after connecting or a switch, which asked.
			if (!fresh && tellsUnsaved(conn.device.capabilities)) {
				const now = await playing(conn);
				if (devicePeqStore.connection !== conn) return;
				devicePeqStore.reported(now.slot, now.enabled);
			}
			const request = devicePeqStore.readTarget;
			if (!request) return;
			const result = await conn.device.pull(request);
			const left = readBands(result.filters);
			const held = devicePeqStore.perChannel ? result.right : undefined;
			const rightPreamp = held?.preamp ?? result.preamp;
			const apart =
				!!held && (!sameBands(result.filters, held.filters) || rightPreamp !== result.preamp);
			const right = held && apart ? readBands(held.filters) : null;
			const eq: EqLoad = {
				filters: left.filters,
				preamp: readPreamp(left.filters, result.preamp),
				...(right
					? { right: { filters: right.filters, preamp: readPreamp(right.filters, rightPreamp) } }
					: {})
			};
			if (fresh) eqStore.open(eq);
			else eqStore.load(eq);
			devicePeqStore.synced = devicePeqStore.snapshot();
			const count = Math.max(left.filters.length, right?.filters.length ?? 0);
			const skipped = left.skipped + (right?.skipped ?? 0);
			const read = right
				? m.device_peq_status_read_apart({ count })
				: m.device_peq_status_read({ count });
			const said = skipped > 0 ? `${read}. ${m.device_peq_read_skipped({ count: skipped })}` : read;
			devicePeqStore.setStatus(note ? `${note} ${said}` : said);
		});
	}

	/**
	 * The plan for writing the list as it is now. When it leaves device bands empty, the target
	 * preset is read once first (and kept in `devicePeqStore.layout` until the preset changes), so
	 * those bands keep the device's own layout. Null when the device went away meanwhile, or is busy
	 * with another operation.
	 */
	async prepare(): Promise<PushPlan | null> {
		const conn = devicePeqStore.connection;
		if (!conn || !devicePeqStore.writeTarget) return null;
		const caps = conn.device.capabilities;
		const plan = (hints?: Layout | null) => planPush(writtenEq(), conn.profile, caps, hints);
		const first = plan(devicePeqStore.layout?.hints);
		const empty = first.emptySlots + (first.right?.emptySlots ?? 0);
		if (empty === 0 || devicePeqStore.layout) return first;
		const slot = devicePeqStore.activeSlot;
		const hints = await this.#operate('write', () =>
			readLayout(conn.device, readRequest(caps, slot, devicePeqStore.deviceSlot))
		);
		if (hints === undefined || devicePeqStore.connection !== conn) return null;
		if (devicePeqStore.activeSlot === slot) devicePeqStore.layout = { slot, hints };
		return plan(hints);
	}

	/**
	 * The Write button (and the sync bar's Write and Review): straight away when the device holds
	 * the list exactly, else after the user reviews the changes in the dialog (`review`). `then`
	 * runs once it is written, whether at once or after the volume warning and the review; never if
	 * either is turned down or the write fails.
	 */
	async requestWrite(then?: () => Promise<void>): Promise<void> {
		if (this.#ask(() => this.requestWrite(then))) return;
		const source = devicePeqStore.snapshot();
		const plan = await this.prepare();
		if (!plan) return;
		if (needsConfirmation(plan)) {
			this.review = plan;
			this.#reviewed = source;
			this.#afterReview = then ?? null;
		} else if ((await this.write(plan)) && then) await then();
	}

	/**
	 * The review's answer: write the plan it showed, or drop it. If the list changed while the
	 * review was up (the modernGraphTool link edits it meanwhile), what's there now is planned
	 * again instead: the plan was for a list no longer on screen.
	 */
	async confirmReview(confirmed: boolean): Promise<void> {
		const plan = this.review;
		const source = this.#reviewed;
		const then = this.#afterReview ?? undefined;
		this.review = null;
		this.#reviewed = null;
		this.#afterReview = null;
		if (!confirmed || !plan) return;
		if (source && !unchanged(source, devicePeqStore.snapshot())) return this.requestWrite(then);
		if ((await this.write(plan)) && then) await then();
	}

	/**
	 * Send `plan` to the preset Device EQ shows. Whether it was written. An automatic write that
	 * fails stops auto-write on this connection.
	 */
	async write(plan: PushPlan, auto = false): Promise<boolean> {
		const conn = devicePeqStore.connection;
		const request = devicePeqStore.writeTarget;
		if (!conn || !request) return false;
		const snapshot = devicePeqStore.snapshot();
		const { right } = plan;
		const written = await this.#operate(
			'write',
			async () => {
				const result = await conn.device.push({
					filters: plan.filters,
					...(plan.preamp !== undefined ? { preamp: plan.preamp } : {}),
					// A device that drives its channels apart gets the right one on every write, equal or
					// not: what it keeps of the two (Topping's L/R-mode flag) follows from it.
					...(right
						? {
								right: {
									filters: right.filters,
									...(right.preamp !== undefined ? { preamp: right.preamp } : {})
								}
							}
						: {}),
					...request
				});
				devicePeqStore.synced = snapshot;
				devicePeqStore.autoPaused = false;
				const count = bandsWritten(plan);
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
			},
			(e) => {
				if (auto) devicePeqStore.autoStopped = true;
				this.fail(e, 'write', auto ? m.device_peq_auto_stopped() : undefined);
				hapticError();
				// An automatic write fails while the user looks at something else (the band editor
				// covers the sync bar): say so where they are.
				if (auto && devicePeqStore.statusMessage)
					noticeStore.say(devicePeqStore.statusMessage, true);
			}
		);
		return written ?? false;
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
	 * Switch the device to what Device EQ picked: `p<id>` for a preset, `on`, `unsaved` (on, with
	 * the EQ it holds on no preset: none is loaded over it), or `off`. A preset picked is then read,
	 * unless the list holds changes not written yet.
	 */
	async switchTo(value: string): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn || devicePeqStore.operation !== null) return;
		// The value also comes over the modernGraphTool link: only what Device EQ offers is taken, so
		// nothing else turns the EQ on or aims at a preset the device doesn't list.
		const offered =
			value === 'on' || value === 'off'
				? conn.device.capabilities.canEnable
				: value === 'unsaved'
					? devicePeqStore.unsaved
					: devicePeqStore.slots.some((s) => `p${s.id}` === value);
		if (!offered) return;
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
		const switched = await this.#operate('switch', async () => {
			if (value === 'off') {
				await conn.device.setEnabled(false);
				devicePeqStore.played('off');
				return false;
			}
			await conn.device.setEnabled(true, slot);
			devicePeqStore.played(slot);
			return true;
		});
		if (switched && !devicePeqStore.hasUnwritten) await this.read(true);
	}

	// ── The device's own list of presets ──────────────────────────────────────

	/** The list again, and what the device plays, after it changed. */
	async #relist(conn: DeviceConnection): Promise<Slot[] | null> {
		const slots = await listed(conn);
		const { slot, enabled } = await playing(conn);
		if (slots && devicePeqStore.connection === conn) devicePeqStore.relisted(slots, slot, enabled);
		return slots;
	}

	/**
	 * Add an empty preset to the device and make it the one Device EQ shows. The list isn't read
	 * over if it holds changes not written yet: they can then be written to the new preset.
	 */
	async createPreset(): Promise<void> {
		const conn = devicePeqStore.connection;
		const room = devicePeqStore.slotRoom;
		if (!conn?.device.createSlot || !devicePeqStore.canEditPresets || devicePeqStore.isBusy) return;
		if (room !== null && devicePeqStore.slots.length >= room) return;
		this.#cancelPending();
		// The device goes over to the new preset, which is flat: as audible as a write.
		if (this.#ask(() => this.createPreset())) return;
		const create = conn.device.createSlot.bind(conn.device);
		// Kept even when listing again fails: the device has the preset by then.
		let made = null as Slot | null;
		await this.#operate(
			'preset',
			async () => {
				made = await create();
				await this.#relist(conn);
				logger.info(`created preset ${made.id} "${made.name}"`);
				devicePeqStore.setStatus(m.device_peq_presets_created({ name: made.name }));
			},
			(e) => this.#presetFailed(e, conn)
		);
		if (made && devicePeqStore.connection === conn) await this.switchTo(`p${made.id}`);
	}

	/** A preset could not be made or deleted: say so, and show what the device holds whatever it did. */
	async #presetFailed(error: unknown, conn: DeviceConnection): Promise<void> {
		this.fail(error, 'preset');
		hapticError();
		if (!devicePeqStore.needsReconnect) await this.#relist(conn);
	}

	/**
	 * Rename preset `id`; true when the device took the name. A name the device can't store is
	 * refused as it is, not shortened to fit.
	 */
	async renamePreset(id: number, name: string): Promise<boolean> {
		const conn = devicePeqStore.connection;
		const slot = devicePeqStore.slots.find((s) => s.id === id);
		if (!conn?.device.renameSlot || !slot || !devicePeqStore.canEditPresets) return false;
		if (devicePeqStore.isBusy) return false;
		const next = name.trim();
		if (next === slot.name) return true;
		const rename = conn.device.renameSlot.bind(conn.device);
		const renamed = await this.#operate(
			'preset',
			async () => {
				await rename(slot.id, next);
				await this.#relist(conn);
				logger.info(`renamed preset ${slot.id} to "${next}"`);
				devicePeqStore.setStatus(m.device_peq_presets_renamed({ name: next }));
				return true;
			},
			(e) => {
				if (errorCode(e) === 'invalid-request') {
					logger.error('device preset failed:', e instanceof Error ? e.message : String(e));
					devicePeqStore.setStatus(m.device_peq_presets_name_refused(), true);
					devicePeqStore.failure = { op: 'preset', code: 'invalid-request' };
				} else {
					this.fail(e, 'preset');
				}
				hapticError();
			}
		);
		return renamed ?? false;
	}

	/**
	 * Delete preset `id`, for good. The device may move to another of its presets: the target then
	 * follows it (`devicePeqStore.deleted`), and the preset it went to is read unless the list holds
	 * changes not written yet.
	 */
	async deletePreset(id: number): Promise<void> {
		const conn = devicePeqStore.connection;
		const slot = devicePeqStore.slots.find((s) => s.id === id);
		if (!conn?.device.deleteSlot || !slot || !devicePeqStore.canEditPresets) return;
		if (devicePeqStore.isBusy || devicePeqStore.slots.length <= 1) return;
		// A waiting auto-write was aimed at the target's id, which the delete may move.
		this.#cancelPending();
		// The device may go over to another preset: as audible as a write.
		if (this.#ask(() => this.deletePreset(id))) return;
		const remove = conn.device.deleteSlot.bind(conn.device);
		const retargeted = await this.#operate(
			'preset',
			async () => {
				await remove(slot.id);
				const slots = await conn.device.slots!();
				const now = await playing(conn);
				if (devicePeqStore.connection !== conn) return false;
				const moved = devicePeqStore.deleted(slot.id, [...slots], now.slot, now.enabled);
				logger.info(`deleted preset ${slot.id} "${slot.name}", the device is on ${now.slot}`);
				devicePeqStore.setStatus(m.device_peq_presets_deleted({ name: slot.name }));
				return moved;
			},
			(e) => this.#presetFailed(e, conn)
		);
		if (retargeted && !devicePeqStore.hasUnwritten) await this.read(true);
	}

	// ── The device's EQs ──────────────────────────────────────────────────────

	/**
	 * The EQ row: edit another of the device's EQs. Changes the EQ on screen never got stay with it,
	 * never carried onto the other (a 10-band list doesn't belong on a 20-band left and right EQ):
	 * one waiting for auto-write goes out first, and any other waits for the dialog (`eqLeaving`).
	 */
	async selectEq(id: string | undefined): Promise<void> {
		const store = devicePeqStore;
		if (!store.canEdit || store.isBusy || id === store.eq) return;
		if (!store.eqs.some((e) => e.id === id && e.present)) return;
		if (store.autoDueAt !== null) await this.writeNow();
		if (store.hasUnwritten) this.eqLeaving = { to: id };
		else await this.#openEq(id);
	}

	/**
	 * The dialog's answer. Write sends the list to the EQ on screen, as the Write button does (the
	 * volume warning and the review included), and switches once it is written; Discard switches,
	 * leaving the changes behind; Cancel stays.
	 */
	async leaveEq(answer: 'write' | 'discard' | 'cancel'): Promise<void> {
		const pending = this.eqLeaving;
		this.eqLeaving = null;
		if (!pending || answer === 'cancel') return;
		if (answer === 'discard') return this.#openEq(pending.to);
		await this.requestWrite(() => this.#openEq(pending.to));
	}

	/**
	 * Make EQ `id` the one the list edits, as connecting opens one: the sync state starts over, its
	 * band count, preset, switch and presets are read, then its bands, as a fresh start (no undo
	 * back to the other EQ's). One the device's mode lacks now is shown absent and the profile's own
	 * EQ opened instead; `gone` is one already found missing. The status line says which happened.
	 */
	async #openEq(id: string | undefined, gone?: string, absent?: readonly string[]): Promise<void> {
		const conn = devicePeqStore.opened;
		if (!conn || !devicePeqStore.canEdit) return;
		// An edit waiting to be auto-written belongs to the EQ it was made on.
		this.#cancelPending();
		let note: string | undefined;
		const opened = await this.#operate(
			'eq',
			async () => {
				let target = id;
				if (target !== undefined && !(await eqThere(conn, target))) {
					gone = target;
					target = undefined;
				}
				const { eq, view, slot, enabled, slots } = await openEq(conn, target);
				if (devicePeqStore.opened !== conn) return false;
				this.#linkFor(view);
				devicePeqStore.selectEq(eq, slot, enabled, slots, gone, absent);
				const named = (of: string | undefined) =>
					eqLabel(devicePeqStore.eqs.find((e) => e.id === of) ?? {});
				if (gone !== undefined) {
					note = m.device_peq_status_eq_gone({ eq: named(gone), own: named(eq.id) });
				}
				// The read that follows says what it read; this stands where it can't read.
				devicePeqStore.setStatus(note ?? m.device_peq_status_eq({ eq: named(eq.id) }));
				logger.info(`${conn.name}: editing EQ ${eq.id ?? '(own)'}${gone ? `, ${gone} gone` : ''}`);
				return true;
			},
			(e) => {
				this.fail(e, 'eq');
				hapticError();
			}
		);
		if (opened) await this.read(true, note);
	}

	/**
	 * Whether the device's mode moved since the EQ on screen was opened: a listed EQ came or went,
	 * or the one on screen counts other bands (a Qudelix switched between its layered and single-EQ
	 * modes on the device or in its own app). The EQ is then opened again as a switch opens one,
	 * read included, since the list no longer fits what it was read from. Only a device that lists
	 * EQs is asked.
	 */
	async #modeMoved(): Promise<boolean> {
		const conn = devicePeqStore.opened;
		const eq = devicePeqStore.openedEq;
		if (!conn || !eq || conn.device.capabilities.eqs.length === 0) return false;
		try {
			const absent = await absentEqs(conn);
			const was = devicePeqStore.absent;
			const there = eq.id === undefined || !absent.includes(eq.id);
			const same =
				there &&
				absent.length === was.length &&
				absent.every((id) => was.includes(id)) &&
				(await reportedBands(conn, eq.id)) === eq.bandCount;
			if (devicePeqStore.opened !== conn) return true;
			if (same) return false;
			await this.#openEq(eq.id, undefined, absent);
		} catch (e) {
			this.fail(e, 'read');
		}
		return true;
	}

	/**
	 * An operation on the listed EQ the list edits was refused as unsupported. If the device's mode
	 * has lost that EQ (switched on the device or in its own app), the profile's own is opened
	 * instead; otherwise the failure stands as it was said.
	 */
	async #checkEq(): Promise<void> {
		const conn = devicePeqStore.opened;
		const id = devicePeqStore.eq;
		if (!conn || id === undefined) return;
		if (await eqThere(conn, id).catch(() => true)) return;
		// The operation that failed may still be showing what the device holds.
		await this.#operating;
		// Another device, or another EQ, by now: nothing to fall back from.
		if (devicePeqStore.opened !== conn || devicePeqStore.eq !== id) return;
		await this.#openEq(undefined, id);
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
				const seen: Seen = { eq: devicePeqStore.snapshot(), conn: devicePeqStore.connection };
				untrack(() => this.#changed(seen));
			});
		});
	}

	#changed(now: Seen): void {
		const before = this.#seen;
		this.#seen = now;
		// A new connection is a new baseline, never an edit: connecting must not write.
		if (!before || before.conn !== now.conn || !now.conn) return this.#cancelPending();
		if (unchanged(before.eq, now.eq)) return;
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
