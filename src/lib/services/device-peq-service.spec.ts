import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { ds3Connection } from '#lib/device-peq/__fixtures__/ds3.js';
import type { DeviceConnection, ReopenWait } from '#lib/device-peq/types.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import type { DeviceIoPlugin, NativeUsbDevice } from '#lib/transports/native/device-io.js';
import { devicePeqService } from './device-peq-service.svelte';

const connect = vi.hoisted(() => ({
	drivableNative: vi.fn(async () => true),
	connectNativeHid: vi.fn(async (): Promise<unknown> => ({ kind: 'cancelled' })),
	connectHid: vi.fn(async (): Promise<unknown> => ({ kind: 'cancelled' }))
}));
const native = vi.hoisted(() => ({ isNative: true }));

vi.mock('#lib/platform/native.js', () => native);
vi.mock('#lib/device-peq/connect.js', () => connect);

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

describe('devicePeqService reading the device', () => {
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
		// The volume warning has its own specs below.
		settingsStore.writeWarning = false;
	});

	afterEach(() => {
		devicePeqStore.forget();
		settingsStore.writeWarning = true;
	});

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

	it('reads an EQ switch apart from the preset, and reads that preset with the EQ off', async () => {
		const { conn, pull } = device();
		Object.assign(conn.device.capabilities, { readsEnabled: true, readsSlot: true });
		vi.spyOn(conn.device, 'currentSlot').mockResolvedValue(2);
		const eqEnabled = vi.spyOn(conn.device, 'eqEnabled').mockResolvedValue(false);
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(eqEnabled).toHaveBeenCalledOnce();
		expect(devicePeqStore.selection).toBe('off');
		expect(pull).toHaveBeenCalledWith(expect.objectContaining({ slot: 2 }));
	});

	it("doesn't ask for an EQ switch the protocol doesn't read", async () => {
		const { conn } = device();
		const eqEnabled = vi.spyOn(conn.device, 'eqEnabled');
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(eqEnabled).not.toHaveBeenCalled();
		expect(devicePeqStore.selection).toBe(1);
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

describe('devicePeqService volume warning', () => {
	/** A device that can switch presets, connected through the service as a press would. */
	async function connectDevice(profileSource: 'device' | 'demo' = 'device') {
		const conn = {
			...fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
				canEnable: true,
				slots: [
					{ id: 1, name: 'USER1' },
					{ id: 2, name: 'USER2' }
				]
			}),
			profileSource
		};
		vi.spyOn(conn.device, 'pull').mockResolvedValue({ filters: [PEAK], preamp: 0 });
		vi.spyOn(conn.device, 'currentSlot').mockResolvedValue(1);
		const push = vi.spyOn(conn.device, 'push');
		const setEnabled = vi.spyOn(conn.device, 'setEnabled');
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		return { push, setEnabled };
	}

	const PEAK = { type: 'PK' as const, freq: 1000, gain: -3, q: 1 };

	beforeEach(() => {
		devicePeqStore.forget();
		eqStore.reset();
	});

	afterEach(async () => {
		await devicePeqService.disconnect();
		devicePeqStore.forget();
		settingsStore.autoPushEnabled = true;
		settingsStore.writeWarning = true;
	});

	it('asks on connecting with auto-write on, and writes what waited once the user goes on', async () => {
		const { push } = await connectDevice();
		expect(devicePeqService.volumeWarning).toBe(true);
		eqStore.update(0, { gain: -5 });
		devicePeqService.setAutoWrite(true);
		await Promise.resolve();
		expect(push).not.toHaveBeenCalled();

		await devicePeqService.answerVolumeWarning(true);
		expect(devicePeqService.volumeWarning).toBe(false);
		expect(push).toHaveBeenCalledOnce();
	});

	it('asks before a Write with auto-write off, then writes', async () => {
		settingsStore.autoPushEnabled = false;
		const { push } = await connectDevice();
		expect(devicePeqService.volumeWarning).toBe(false);

		eqStore.update(0, { gain: -5 });
		await devicePeqService.requestWrite();
		expect(devicePeqService.volumeWarning).toBe(true);
		expect(push).not.toHaveBeenCalled();

		await devicePeqService.answerVolumeWarning(true);
		expect(push).toHaveBeenCalledOnce();
		// Once per connection: the next Write goes straight out.
		eqStore.update(0, { gain: -6 });
		await devicePeqService.requestWrite();
		expect(push).toHaveBeenCalledTimes(2);
	});

	it('asks before switching presets', async () => {
		settingsStore.autoPushEnabled = false;
		const { setEnabled } = await connectDevice();
		await devicePeqService.switchTo('p2');
		expect(setEnabled).not.toHaveBeenCalled();
		await devicePeqService.answerVolumeWarning(true);
		expect(setEnabled).toHaveBeenCalledWith(true, 2);
	});

	it('writes nothing on Not now, stops auto-write for the connection, and asks the next one', async () => {
		const { push } = await connectDevice();
		eqStore.update(0, { gain: -5 });
		await devicePeqService.answerVolumeWarning(false);
		expect(devicePeqService.volumeWarning).toBe(false);
		expect(devicePeqService.autoWriteOn).toBe(false);
		expect(settingsStore.autoPushEnabled).toBe(true);
		expect(push).not.toHaveBeenCalled();

		await devicePeqService.requestWrite();
		expect(devicePeqService.volumeWarning).toBe(true);
		await devicePeqService.answerVolumeWarning(false);

		await devicePeqService.disconnect();
		await connectDevice();
		expect(devicePeqService.volumeWarning).toBe(true);
	});

	it('stops asking once told not to show it again', async () => {
		await connectDevice();
		await devicePeqService.answerVolumeWarning(true, true);
		expect(settingsStore.writeWarning).toBe(false);
		await devicePeqService.disconnect();
		await connectDevice();
		expect(devicePeqService.volumeWarning).toBe(false);
	});

	it('never asks for the demo device', async () => {
		settingsStore.autoPushEnabled = false;
		const { push } = await connectDevice('demo');
		eqStore.update(0, { gain: -5 });
		await devicePeqService.requestWrite();
		expect(devicePeqService.volumeWarning).toBe(false);
		expect(push).toHaveBeenCalledOnce();
	});
});

describe('devicePeqService reading the preamp', () => {
	function connectWith(preamp: number) {
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }));
		vi.spyOn(conn.device, 'pull').mockResolvedValue({
			filters: [{ type: 'PK', freq: 1000, gain: 6, q: 1 }],
			preamp
		});
		devicePeqStore.setConnected(conn, null);
	}

	afterEach(() => {
		devicePeqStore.forget();
		eqStore.reset();
	});

	it('follows the bands where the device holds what Auto would write', async () => {
		connectWith(-6);
		await devicePeqService.read(true);
		expect(eqStore.autoPreamp).toBe(true);
	});

	it("keeps the device's own preamp, fixed, where it differs", async () => {
		connectWith(-2);
		await devicePeqService.read(true);
		expect(eqStore.autoPreamp).toBe(false);
		expect(eqStore.preamp).toBe(-2);
	});
});

describe('devicePeqService after a save that restarts the device', () => {
	const PEAK = { type: 'PK' as const, freq: 1000, gain: -3, q: 1 };
	const USB = { vendorId: '0x3302', productId: '0xc20f', productName: 'Protocol Micro' };

	/** A device that drops the connection on every save, as KT Micro chips do. */
	function restarting() {
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
			disconnectOnSave: true,
			slots: [{ id: 1, name: 'USER1' }]
		});
		conn.identity = { usb: USB };
		vi.spyOn(conn.device, 'pull').mockResolvedValue({ filters: [PEAK], preamp: 0 });
		vi.spyOn(conn.device, 'currentSlot').mockResolvedValue(1);
		vi.spyOn(conn.device, 'push').mockResolvedValue({ reconnect: true });
		return conn;
	}

	/** `conn.reopen`, answered when the spec says. */
	function deferReopen(conn: DeviceConnection) {
		let answer = (_c: DeviceConnection | null) => {};
		const reopen = vi.fn(
			(_wait?: ReopenWait) => new Promise<DeviceConnection | null>((resolve) => (answer = resolve))
		);
		conn.reopen = reopen;
		return { reopen, answer: (c: DeviceConnection | null) => answer(c) };
	}

	async function connectAndWrite(conn: DeviceConnection) {
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		eqStore.update(0, { gain: -5 });
		await devicePeqService.requestWrite();
		await devicePeqService.answerVolumeWarning(true);
	}

	beforeEach(() => {
		devicePeqStore.forget();
		eqStore.reset();
		settingsStore.autoPushEnabled = false;
	});

	afterEach(async () => {
		await devicePeqService.disconnect();
		devicePeqStore.forget();
		settingsStore.autoPushEnabled = true;
	});

	it('waits for the device and reopens it, keeping the volume warning answered', async () => {
		const conn = restarting();
		const { reopen, answer } = deferReopen(conn);
		await connectAndWrite(conn);

		expect(reopen).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));
		expect(devicePeqStore.needsReconnect).toBe(true);
		expect(devicePeqService.sync).toMatchObject({ tone: 'busy' });
		expect(devicePeqService.sync?.actions).toBeUndefined();

		const again = restarting();
		answer(again);
		await vi.waitFor(() => expect(devicePeqStore.connection).toBe(again));
		await vi.waitFor(() => expect(devicePeqStore.isBusy).toBe(false));
		expect(devicePeqStore.needsReconnect).toBe(false);
		expect(devicePeqStore.writeConsent).toBe(true);
		expect(devicePeqStore.statusMessage).toContain('connected again');
	});

	it('offers Reconnect when the device is not back in time', async () => {
		const conn = restarting();
		const { answer } = deferReopen(conn);
		await connectAndWrite(conn);
		answer(null);
		await vi.waitFor(() => expect(devicePeqStore.isConnecting).toBe(false));
		expect(devicePeqStore.connection).toBe(conn);
		expect(devicePeqService.sync).toMatchObject({ tone: 'warning', actions: ['reconnect'] });
	});

	it('closes what comes back after the user disconnected', async () => {
		const conn = restarting();
		const { answer } = deferReopen(conn);
		await connectAndWrite(conn);
		await devicePeqService.disconnect();
		const again = restarting();
		const close = vi.spyOn(again.device, 'close');
		answer(again);
		await vi.waitFor(() => expect(close).toHaveBeenCalled());
		expect(devicePeqStore.connection).toBeNull();
		expect(devicePeqStore.isConnecting).toBe(false);
	});

	it('on Android, keeps the device that detaches before the saving write returns', async () => {
		const conn = { ...restarting(), usbDeviceName: DAC.deviceName };
		vi.spyOn(conn.device, 'push').mockImplementation(async () => {
			await devicePeqService.usbDetached(DAC.deviceName);
			return { reconnect: true };
		});
		const { reopen, answer } = deferReopen(conn);
		await connectAndWrite(conn);
		expect(devicePeqStore.connection).toBe(conn);
		expect(reopen).toHaveBeenCalledOnce();

		const again = restarting();
		answer(again);
		await vi.waitFor(() => expect(devicePeqStore.connection).toBe(again));
		await vi.waitFor(() => expect(devicePeqStore.isBusy).toBe(false));
	});

	it('on Android, keeps the device through its detach and reopens it when it attaches', async () => {
		const conn = { ...restarting(), usbDeviceName: DAC.deviceName };
		const { reopen, answer } = deferReopen(conn);
		await connectAndWrite(conn);
		answer(null);
		await vi.waitFor(() => expect(devicePeqStore.isConnecting).toBe(false));

		await devicePeqService.usbDetached(DAC.deviceName);
		expect(devicePeqStore.connection).toBe(conn);

		await devicePeqService.usbAttached({ ...DAC, productName: 'Keyboard' });
		expect(reopen).toHaveBeenCalledOnce();
		const again = restarting();
		reopen.mockResolvedValueOnce(again);
		await devicePeqService.usbAttached({ ...DAC, deviceName: '/dev/bus/usb/001/003' });
		expect(reopen).toHaveBeenLastCalledWith();
		expect(devicePeqStore.connection).toBe(again);
		expect(connect.connectNativeHid).toHaveBeenCalledOnce();
	});
});

describe('devicePeqService device controls', () => {
	async function connectDs3(values?: Record<string, number>, firmware?: string) {
		const ds3 = ds3Connection(values, firmware);
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: ds3.conn });
		await devicePeqService.connect('hid');
		return ds3;
	}

	beforeEach(() => {
		devicePeqStore.forget();
		eqStore.reset();
		settingsStore.writeWarning = false;
	});

	afterEach(async () => {
		await devicePeqService.disconnect();
		devicePeqStore.forget();
		settingsStore.writeWarning = true;
	});

	it('reads the controls the device has now, and its firmware', async () => {
		await connectDs3();
		expect(devicePeqStore.firmware).toBe('1.6.10');
		expect(devicePeqStore.controls.map((c) => c.id)).toEqual([
			'uacMode',
			'filterMode',
			'upsample',
			'volume',
			'led'
		]);
		await connectDs3(undefined, '1.4.6');
		expect(devicePeqStore.controls.map((c) => c.id)).not.toContain('upsample');
	});

	it('reads nothing more of a device without controls', async () => {
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), { readsFirmware: true });
		const firmware = vi.spyOn(conn.device, 'firmware');
		const readControls = vi.spyOn(conn.device, 'readControls');
		connect.connectNativeHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(firmware).not.toHaveBeenCalled();
		expect(readControls).not.toHaveBeenCalled();
		expect(devicePeqStore.controls).toEqual([]);
	});

	it('writes a control, then reads them all again', async () => {
		const { conn } = await connectDs3();
		const write = vi.spyOn(conn.device, 'writeControl');
		await devicePeqService.setControl('volume', 30);
		expect(write).toHaveBeenCalledWith('volume', 30);
		expect(devicePeqStore.controlValues.volume).toBe(30);
		expect(devicePeqStore.isBusy).toBe(false);
	});

	it('says when a control stops the EQ applying', async () => {
		await connectDs3();
		expect(devicePeqService.sync?.text ?? '').not.toContain("doesn't apply its EQ");
		await devicePeqService.setControl('upsample', 1);
		expect(devicePeqStore.eqOffBy.map((c) => c.id)).toEqual(['upsample']);
		expect(devicePeqService.sync).toMatchObject({
			tone: 'warning',
			text: "The device doesn't apply its EQ with this Upsampling setting."
		});
	});

	it('reports a failed write and shows what the device holds', async () => {
		const { conn } = await connectDs3();
		vi.spyOn(conn.device, 'writeControl').mockRejectedValue(new Error('no answer'));
		await devicePeqService.setControl('led', 0);
		expect(devicePeqStore.statusIsError).toBe(true);
		expect(devicePeqStore.controlValues.led).toBe(1);
		expect(devicePeqStore.isBusy).toBe(false);
	});

	it('reopens a device that restarts for a control, and reads its controls there', async () => {
		const { conn } = await connectDs3();
		const close = vi.spyOn(conn.device, 'close');
		const again = ds3Connection({ uacMode: 1, gameMode: 0, volume: 24, led: 1 });
		const reopen = vi.fn(async (_wait?: ReopenWait) => again.conn);
		conn.reopen = reopen;

		await devicePeqService.setControl('uacMode', 1);
		expect(close).toHaveBeenCalled();
		expect(reopen).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));
		expect(devicePeqStore.connection).toBe(again.conn);
		expect(devicePeqStore.needsReconnect).toBe(false);
		expect(devicePeqStore.controls.map((c) => c.id)).toEqual([
			'uacMode',
			'gameMode',
			'volume',
			'led'
		]);
		expect(devicePeqStore.statusMessage).toBe(
			'Changed USB mode. The device restarted and is connected again.'
		);
	});

	it('on Android, reopens a device that attaches under its other USB identity', async () => {
		const { conn } = await connectDs3();
		conn.reopen = vi.fn(async () => null);
		await devicePeqService.setControl('uacMode', 1);
		const again = ds3Connection({ uacMode: 1, gameMode: 0, volume: 24, led: 1 });
		conn.reopen = vi.fn(async () => again.conn);
		const uac1 = { vendorId: 0x20b1, productId: 0x80d5, productName: 'Fosi Audio DS3' };
		await devicePeqService.usbAttached({ ...DAC, ...uac1 });
		expect(devicePeqStore.connection).toBe(again.conn);
	});

	describe('in the browser', () => {
		beforeEach(() => void connect.connectHid.mockClear());
		afterEach(() => void (native.isNative = true));

		async function notFoundAfterUsbMode() {
			const { conn } = await connectDs3();
			native.isNative = false;
			conn.reopen = vi.fn(async () => null);
			await devicePeqService.setControl('uacMode', 1);
			return conn;
		}

		it('asks through the chooser when Reconnect is clicked and the device is not granted', async () => {
			await notFoundAfterUsbMode();
			const again = ds3Connection({ uacMode: 1, gameMode: 0, volume: 24, led: 1 });
			connect.connectHid.mockResolvedValueOnce({ kind: 'connected', connection: again.conn });
			await devicePeqService.reconnect({ choose: true });
			expect(connect.connectHid).toHaveBeenCalledOnce();
			expect(devicePeqStore.connection).toBe(again.conn);
			expect(devicePeqStore.controlValues.uacMode).toBe(1);
		});

		it('says to reconnect when the chooser is cancelled', async () => {
			await notFoundAfterUsbMode();
			await devicePeqService.reconnect({ choose: true });
			expect(devicePeqStore.connection).toBeNull();
			expect(devicePeqStore.statusMessage).toBe(
				"Couldn't find the device again. Plug it in and connect."
			);
		});

		it('never opens the chooser without a click', async () => {
			await notFoundAfterUsbMode();
			await devicePeqService.reconnect();
			expect(connect.connectHid).not.toHaveBeenCalled();
			expect(devicePeqStore.connection).toBeNull();
		});
	});

	it('offers Reconnect when a device that restarted for a control is not found', async () => {
		const { conn } = await connectDs3();
		conn.reopen = vi.fn(async () => null);
		await devicePeqService.setControl('uacMode', 1);
		expect(devicePeqStore.needsReconnect).toBe(true);
		expect(devicePeqService.sync).toMatchObject({
			text: 'Changed USB mode. The device restarted; reconnect to carry on.',
			actions: ['reconnect']
		});
	});
});
