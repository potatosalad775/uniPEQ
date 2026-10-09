import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import type { DeviceIoPlugin, NativeUsbDevice } from '$lib/transports/native/device-io';
import { devicePeqService } from './device-peq-service.svelte';

const connect = vi.hoisted(() => ({
	drivableNative: vi.fn(async () => true),
	connectNativeHid: vi.fn(async () => ({ kind: 'cancelled' }))
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
