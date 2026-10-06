// Adapted from modernGraphTool src/lib/services/device-peq-service.svelte.ts and the connect flow
// of components/features/DevicePeq.svelte @ 23ddc4dd. Write and auto-write arrive in Phase 3.
/**
 * Connects, reads and switches the device, independent of any screen: screens unmount on every
 * tab switch, and a connection has to outlive them.
 */
import type { ConnectResult } from '$lib/device-peq/connect';
import { describeDeviceError, isConnectionLost } from '$lib/device-peq/errors';
import type { DeviceCandidate, DeviceConnection } from '$lib/device-peq/types';
import { fromCapsFilter } from '$lib/eq/model';
import * as m from '$lib/paraglide/messages';
import { isNative } from '$lib/platform/native';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import { logger } from './logger';

export type ConnectKind = 'hid' | 'serial' | 'ble';

type Choice = Extract<ConnectResult, { kind: 'choose' }>;

const loadConnect = () => import('$lib/device-peq/connect');

class DevicePeqService {
	/** A connect attempt waiting for the user to pick a profile or (Android) a device. */
	choice = $state.raw<{ candidates: DeviceCandidate[] } | null>(null);
	/** Why the last connect attempt found nothing to drive, until the next one. */
	notFound = $state<'unsupported' | 'no-device' | null>(null);

	#choice: Choice | null = null;

	/** Load the connect module and the device database before a click needs them. */
	warmUp(): void {
		void loadConnect().then((mod) => mod.warmUp());
	}

	/** Report a failed operation in the status line. */
	fail(error: unknown, op: string): void {
		logger.error(`device ${op} failed:`, error instanceof Error ? error.message : String(error));
		devicePeqStore.setStatus(describeDeviceError(error), true);
		if (isConnectionLost(error) && devicePeqStore.connection) devicePeqStore.needsReconnect = true;
	}

	/** USB HID goes through the DeviceIo plugin on Android, the browser's chooser elsewhere. */
	async connect(kind: ConnectKind): Promise<void> {
		await this.#run(async () => {
			const mod = await loadConnect();
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
		await conn.device.close().catch(() => {});
		devicePeqStore.setDisconnected();
	}

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

	/** Switch the device to what Device EQ picked: `p<id>` for a preset, `on`, or `off`. */
	async switchTo(value: string): Promise<void> {
		const conn = devicePeqStore.connection;
		if (!conn) return;
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
}

export const devicePeqService = new DevicePeqService();
