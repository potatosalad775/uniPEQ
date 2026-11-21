import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { noticeStore } from '#lib/stores/notice-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import { devicePeqService } from './device-peq-service.svelte';

const BAND = { type: 'PK', freq: 1000, q: 1, gain: 0 };

async function connected() {
	const conn = fakeConnection(hardwareProfile('dac', { bandCount: 1 }));
	conn.device.pull = async () => ({ filters: [{ ...BAND }], preamp: 0 }) as never;
	const pushed: number[] = [];
	const push = vi.fn(async (r: { filters: { gain: number }[] }) => {
		pushed.push(r.filters[0].gain);
		return { reconnect: false };
	});
	conn.device.push = push as never;
	devicePeqStore.setConnected(conn, null, true);
	devicePeqService.install();
	await devicePeqService.read(true);
	flushSync();
	return { conn, pushed, push };
}

function edit(gain: number) {
	eqStore.update(0, { gain });
	flushSync();
}

describe('auto-write through its timer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		settingsStore.autoPushEnabled = true;
		settingsStore.writeWarning = false;
	});
	afterEach(() => {
		devicePeqStore.forget();
		vi.useRealTimers();
		settingsStore.writeWarning = true;
	});

	it('writes an edit once the delay has passed', async () => {
		const { pushed } = await connected();
		edit(3);
		expect(devicePeqStore.autoDueAt).not.toBeNull();
		expect(pushed).toEqual([]);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(pushed).toEqual([3]);
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('writes an edit made during a write next', async () => {
		const { conn, pushed } = await connected();
		let release = () => {};
		const first = conn.device.push;
		conn.device.push = ((r: never) =>
			new Promise((resolve) => {
				release = () => void first(r).then(resolve);
			})) as never;
		edit(3);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(devicePeqStore.operation).toBe('write');
		conn.device.push = first;
		edit(5);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		release();
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs * 3);
		expect(pushed).toEqual([3, 5]);
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('stops after a failed write, says so, and leaves later edits unwritten', async () => {
		const { conn, push } = await connected();
		conn.device.push = async () => {
			throw Object.assign(new Error('gone'), { name: 'BridgeError', code: 'timeout' });
		};
		edit(3);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(devicePeqStore.autoStopped).toBe(true);
		expect(noticeStore.isError).toBe(true);
		conn.device.push = push as never;
		edit(4);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs * 2);
		expect(push).not.toHaveBeenCalled();
	});

	it('pauses on a list the device cannot hold exactly', async () => {
		const { push } = await connected();
		edit(30);
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(push).not.toHaveBeenCalled();
		expect(devicePeqStore.autoPaused).toBe(true);
	});

	it('drops the countdown when an undo returns to what the device has', async () => {
		const { push } = await connected();
		edit(3);
		expect(devicePeqStore.autoDueAt).not.toBeNull();
		eqStore.undo();
		flushSync();
		expect(devicePeqStore.autoDueAt).toBeNull();
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs * 2);
		expect(push).not.toHaveBeenCalled();
	});

	it('writes after an operation that was under way when the delay passed', async () => {
		const { pushed } = await connected();
		edit(3);
		devicePeqStore.operation = 'switch';
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(pushed).toEqual([]);
		devicePeqStore.operation = null;
		await vi.advanceTimersByTimeAsync(settingsStore.autoPushDelayMs);
		expect(pushed).toEqual([3]);
	});
});
