import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import type { DeviceIoPlugin, NativeUsbDevice } from '$lib/transports/native/device-io';
import { devicePeqService } from './device-peq-service.svelte';

const connect = vi.hoisted(() => ({
	drivableNative: vi.fn(async () => true),
	connectNativeHid: vi.fn(async (): Promise<unknown> => ({ kind: 'cancelled' }))
}));

vi.mock('$lib/platform/native', () => ({ isNative: true }));
vi.mock('$lib/device-peq/connect', () => connect);

const DAC: NativeUsbDevice = {
	deviceName: '/dev/bus/usb/001/002',
	vendorId: 0x3302,
	productId: 0xc20f,
	productName: 'Protocol Micro',
	manufacturerName: 'CrinEar',
	hasPermission: true,
	hidInterfaces: [3]
};

function connectTo(usbDeviceName?: string) {
	const conn = { ...fakeConnection(hardwareProfile('dac', { bandCount: 8 })), usbDeviceName };
	devicePeqStore.setConnected(conn, null);
	return conn;
}

describe('devicePeqService on Android USB events', () => {
	beforeEach(() => {
		connect.drivableNative.mockClear().mockResolvedValue(true);
		connect.connectNativeHid.mockClear();
	});

	afterEach(() => {
		devicePeqStore.forget();
		devicePeqStore.isConnecting = false;
	});

	it('disconnects when the connected device is unplugged, keeping the device', async () => {
		const conn = connectTo(DAC.deviceName);
		const close = vi.spyOn(conn.device, 'close');
		await devicePeqService.usbDetached(DAC.deviceName);
		expect(close).toHaveBeenCalledOnce();
		expect(devicePeqStore.connection).toBeNull();
		expect(devicePeqStore.knownDevice?.name).toBe(conn.name);
	});

	it('ignores another device being unplugged, and connections with no USB path (demo)', async () => {
		connectTo(DAC.deviceName);
		await devicePeqService.usbDetached('/dev/bus/usb/001/009');
		expect(devicePeqStore.connection).not.toBeNull();

		connectTo(undefined);
		await devicePeqService.usbDetached(DAC.deviceName);
		expect(devicePeqStore.connection).not.toBeNull();
	});

	it('connects a drivable device plugged in while nothing is connected', async () => {
		await devicePeqService.usbAttached(DAC);
		expect(connect.drivableNative).toHaveBeenCalledWith(DAC);
		expect(connect.connectNativeHid).toHaveBeenCalledOnce();
	});

	it('leaves a device it cannot drive alone', async () => {
		connect.drivableNative.mockResolvedValue(false);
		await devicePeqService.usbAttached({ ...DAC, productName: 'Keyboard' });
		expect(connect.connectNativeHid).not.toHaveBeenCalled();
	});

	it('does nothing while connected or connecting', async () => {
		connectTo(DAC.deviceName);
		await devicePeqService.usbAttached(DAC);
		devicePeqStore.forget();
		devicePeqStore.isConnecting = true;
		await devicePeqService.usbAttached(DAC);
		expect(connect.drivableNative).not.toHaveBeenCalled();
		expect(connect.connectNativeHid).not.toHaveBeenCalled();
	});

	it('listens to the plugin once', async () => {
		const addListener = vi.fn(async (_event: string) => ({ remove: async () => {} }));
		const plugin = { addListener } as unknown as DeviceIoPlugin;
		await devicePeqService.watchUsb(plugin);
		await devicePeqService.watchUsb(plugin);
		expect(addListener.mock.calls.map(([event]) => event)).toEqual([
			'deviceDetached',
			'deviceAttached'
		]);
	});
});

describe('devicePeqService reading the device (decision 25)', () => {
	const ON_DEVICE = [{ type: 'PK' as const, freq: 100, gain: -2, q: 0.7 }];

	/** A device that holds `ON_DEVICE`, with two presets it can switch between. */
	function device() {
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
			canEnable: true,
			slots: [
				{ id: 1, name: 'USER1' },
				{ id: 2, name: 'USER2' }
			]
		});
		const pull = vi.spyOn(conn.device, 'pull').mockResolvedValue({
			filters: ON_DEVICE,
			preamp: -2
		});
		const setEnabled = vi.spyOn(conn.device, 'setEnabled');
		vi.spyOn(conn.device, 'currentSlot').mockResolvedValue(1);
		return { conn, pull, setEnabled };
	}

	beforeEach(() => {
		devicePeqStore.forget();
		eqStore.reset();
	});

	afterEach(() => devicePeqStore.forget());

	it('reads the EQ of a device it connects', async () => {
		const { conn, pull } = device();
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(pull).toHaveBeenCalledOnce();
		expect(eqStore.filters).toEqual(ON_DEVICE);
		expect(devicePeqStore.inSync).toBe(true);
		// A fresh start: undo can't hand the device the list from before it was read.
		expect(eqStore.canUndo).toBe(false);
	});

	it("doesn't read over changes the device never got, and reads once they're settled", async () => {
		const { conn, pull } = device();
		devicePeqStore.setConnected(conn, 1);
		eqStore.add({ type: 'PK', freq: 1000, gain: 4, q: 1 });
		devicePeqStore.setDisconnected();

		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(pull).not.toHaveBeenCalled();
		expect(eqStore.filters).toHaveLength(1);
		expect(eqStore.filters[0].gain).toBe(4);
		expect(devicePeqStore.unwritten).toBe(true);

		await devicePeqService.read();
		expect(devicePeqStore.hasUnwritten).toBe(false);
		// The Read button's read is undoable, back to the changes it replaced.
		eqStore.undo();
		expect(eqStore.filters[0].gain).toBe(4);
	});

	it('reads the preset Device EQ switches to, unless the list has changes to write', async () => {
		const { conn, pull, setEnabled } = device();
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		pull.mockClear();

		await devicePeqService.switchTo('p2');
		expect(setEnabled).toHaveBeenCalledWith(true, 2);
		expect(pull).toHaveBeenCalledOnce();

		eqStore.update(0, { gain: 5 });
		pull.mockClear();
		await devicePeqService.switchTo('p1');
		expect(pull).not.toHaveBeenCalled();
		expect(eqStore.filters[0].gain).toBe(5);
	});
});
