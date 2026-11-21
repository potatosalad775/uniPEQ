import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { devicePeqService } from './device-peq-service.svelte';

function held<T>(value: T) {
	let release!: () => void;
	const promise = new Promise<T>((resolve) => {
		release = () => resolve(value);
	});
	return { promise, release };
}

function connected(capabilities = {}) {
	const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), capabilities);
	devicePeqStore.setConnected(conn, null, true);
	devicePeqStore.writeConsent = true;
	return conn;
}

describe('one device operation at a time', () => {
	afterEach(() => devicePeqStore.forget());

	it('does not read while a write is under way', async () => {
		const conn = connected();
		const plan = (await devicePeqService.prepare())!;
		const push = held({ reconnect: false });
		conn.device.push = () => push.promise;
		const pull = vi.spyOn(conn.device, 'pull');

		const writing = devicePeqService.write(plan);
		expect(devicePeqStore.operation).toBe('write');
		await devicePeqService.read();
		expect(pull).not.toHaveBeenCalled();
		push.release();
		await writing;
	});

	it('does not switch while a read is under way', async () => {
		const conn = connected({ canEnable: true });
		const pull = held({ filters: [], preamp: 0 });
		conn.device.pull = () => pull.promise;
		const setEnabled = vi.spyOn(conn.device, 'setEnabled');

		const reading = devicePeqService.read(true);
		expect(devicePeqStore.operation).toBe('read');
		await devicePeqService.switchTo('off');
		expect(setEnabled).not.toHaveBeenCalled();
		pull.release();
		await reading;
	});
});

describe('every operation says its result', () => {
	afterEach(() => devicePeqStore.forget());

	it('no longer says what was read once the EQ is switched off', async () => {
		connected({ canEnable: true });
		await devicePeqService.read(true);
		const read = devicePeqStore.statusMessage;
		expect(read).not.toBeNull();
		await devicePeqService.switchTo('off');
		expect(devicePeqStore.eqEnabled).toBe(false);
		expect(devicePeqStore.statusMessage).not.toBe(read);
	});
});

describe('switching to a value Device EQ does not offer', () => {
	afterEach(() => devicePeqStore.forget());

	function withPresets() {
		const slots = [
			{ id: 1, name: 'One', writable: true },
			{ id: 2, name: 'Two', writable: true }
		];
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
			canEnable: true,
			slots
		});
		devicePeqStore.setConnected(conn, 1, true);
		devicePeqStore.writeConsent = true;
		return vi.spyOn(conn.device, 'setEnabled');
	}

	it.each(['other', 'unknown', 'unsaved', '', 'nonsense', 'p99', 'pzz', 'p'])(
		'leaves the device alone for %j',
		async (value) => {
			const setEnabled = withPresets();
			await devicePeqService.switchTo(value);
			expect(setEnabled).not.toHaveBeenCalled();
			expect(devicePeqStore.activeSlot).toBe(1);
		}
	);

	it('still switches to a listed preset, and the EQ off and on', async () => {
		const setEnabled = withPresets();
		await devicePeqService.switchTo('p2');
		await devicePeqService.switchTo('off');
		await devicePeqService.switchTo('on');
		expect(setEnabled.mock.calls).toEqual([[true, 2], [false], [true, 1]]);
	});
});
