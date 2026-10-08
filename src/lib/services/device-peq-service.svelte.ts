// Adapted from modernGraphTool src/lib/services/device-peq-service.svelte.ts and the connect flow
// of components/features/DevicePeq.svelte @ 23ddc4dd: our settings (`autoPushEnabled`, its delay),
// the status line instead of toasts, and the demo device. It replaces the prototype's
// AutoPushScheduler (rebuild decision 20).
/**
 * Connects, reads, writes and switches the device, and auto-writes, independent of any screen:
 * screens unmount on every tab switch, and a connection (and auto-write) has to outlive them.
 * The screens keep only what needs them: the review dialog and the controls.
 */
import { untrack } from 'svelte';
import type { ConnectResult } from '$lib/device-peq/connect';
import { describeDeviceError, isConnectionLost } from '$lib/device-peq/errors';
import { readRequest } from '$lib/device-peq/preset';
import {
	needsConfirmation,
	needsReview,
	planPush,
	readLayout,
	type PushPlan
} from '$lib/device-peq/push-plan';
import { syncStatus, type SyncStatus } from '$lib/device-peq/sync-status';
import type { DeviceCandidate, DeviceConnection } from '$lib/device-peq/types';
import { fromCapsFilter, type EqFilter } from '$lib/eq/model';
import * as m from '$lib/paraglide/messages';
import { hapticError, hapticTick } from '$lib/platform/haptics';
import { isNative } from '$lib/platform/native';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import { noticeStore } from '$lib/stores/notice-store.svelte';
import { settingsStore } from '$lib/stores/settings-store.svelte';
import type { Filter } from '@potatosalad775/eqcaps-core';
import { logger } from './logger';

export type ConnectKind = 'hid' | 'serial' | 'ble' | 'demo';

type Choice = Extract<ConnectResult, { kind: 'choose' }>;

/** What the auto-writer last saw, to tell an edit from a reconnect or a toggle. */
type Seen = { filters: EqFilter[]; preamp: number; conn: DeviceConnection | null };

const loadConnect = () => import('$lib/device-peq/connect');

class DevicePeqService {
	/** A connect attempt waiting for the user to pick a profile or (Android) a device. */
	choice = $state.raw<{ candidates: DeviceCandidate[] } | null>(null);
	/** Why the last connect attempt found nothing to drive, until the next one. */
	notFound = $state<'unsupported' | 'no-device' | null>(null);

	/** A write waiting for the user to confirm what doesn't fit (the review dialog shows it). */
	review = $state.raw<PushPlan | null>(null);

	#choice: Choice | null = null;
	#installed = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = false;
	#again = false;
	#seen: Seen | null = null;

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

	/** What the sync bar and the device chip show (decision 22); null before any device. */
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
			autoDueAt: store.autoDueAt,
			canWrite: !!caps?.canWrite && !!store.writeTarget,
			canRead: !!caps?.canRead && !!store.readTarget,
			message: store.statusMessage,
			messageIsError: store.statusIsError,
			autoWriting: this.autoWriting,
			autoPaused: store.autoPaused,
			autoClipRisk: store.autoClipRisk,
			builtIn,
			unreachable:
				(!!caps?.canWrite && !builtIn && !store.writeTarget) ||
				(!!caps?.canRead && !store.readTarget),
			inSync: store.inSync
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

	async #finishConnect(conn: DeviceConnection): Promise<void> {
		const slot = await conn.device.currentSlot().catch(() => null);
		devicePeqStore.setConnected(conn, slot);
		this.install();
		logger.info(`connected ${conn.name} (${conn.profileId ?? conn.profileSource}), slot ${slot}`);
	}

	/** After the device dropped (or restarted to save): find it again without a chooser. */
	async reconnect(): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		devicePeqStore.isConnecting = true;
		try {
			const again = conn.reopen ? await conn.reopen() : null;
			if (again) await this.#finishConnect(again);
			else {
				devicePeqStore.setDisconnected();
				devicePeqStore.setStatus(m.device_peq_status_reconnect_manual());
			}
		} catch (e) {
			this.fail(e, 'reconnect');
		} finally {
			devicePeqStore.isConnecting = false;
		}
	}

	async disconnect(): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
		this.#cancelPending();
		await conn.device.close().catch(() => {});
		devicePeqStore.setDisconnected();
	}

	// ── Reading and writing ───────────────────────────────────────────────────

	/** Replace the band list with what Device EQ shows. */
	async read(): Promise<void> {
		const conn = devicePeqStore.connection;
		const request = devicePeqStore.readTarget;
		if (!conn || !request) return;
		devicePeqStore.isReading = true;
		try {
			const result = await conn.device.pull(request);
			const bands = result.filters.filter((f) => f !== null);
			const filters = bands.map(fromCapsFilter).filter((f) => f !== null);
			eqStore.replace(filters, result.preamp);
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
			planPush(eqStore.filters, eqStore.preamp, conn.profile, caps, hints ?? undefined);
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
		const plan = await this.prepare();
		if (!plan) return;
		if (needsConfirmation(plan)) this.review = plan;
		else void this.write(plan);
	}

	/** The review dialog's answer: write the plan it showed, or drop it. */
	confirmReview(confirmed: boolean): void {
		const plan = this.review;
		this.review = null;
		if (confirmed && plan) void this.write(plan);
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
				devicePeqStore.needsReconnect = true;
				devicePeqStore.setStatus(m.device_peq_status_saved_reconnect());
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

	/** Switch the device to what Device EQ picked: `p<id>` for a preset, `on`, or `off`. */
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
			if (slot !== undefined) devicePeqStore.target(slot);
			return;
		}
		devicePeqStore.isSwitching = true;
		try {
			if (value === 'off') {
				await conn.device.setEnabled(false);
				devicePeqStore.played('off');
			} else {
				await conn.device.setEnabled(true, slot);
				devicePeqStore.played(slot);
			}
		} catch (e) {
			this.fail(e, 'switch');
		} finally {
			devicePeqStore.isSwitching = false;
		}
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
		void this.#flush();
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
