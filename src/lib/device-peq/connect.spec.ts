// Adapted from modernGraphTool src/lib/device-peq/connect.spec.ts @ 23ddc4dd, plus the Android path.
/**
 * The connect flows: chooser → `matchDevice` → protocol + profile → an open device.
 *
 * The browser choosers and the eqcaps client are mocked (no permission prompt, no network); the
 * bridge itself is real, so `openDevice` checks each protocol against its transport as it would
 * in the app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IndexEntry, Profile } from '@potatosalad775/eqcaps-core';
import type { HidTransport, StreamTransport } from '@potatosalad775/eqcaps-device-bridge';
import type { DeviceIoPlugin, NativeUsbDevice } from '#lib/transports/native/device-io.js';

const browser = vi.hoisted(() => ({
	requestHidDevice: vi.fn(),
	requestSerialPort: vi.fn(),
	requestBleDevice: vi.fn(),
	grantedHidDevice: vi.fn(),
	waitForGrantedHidDevice: vi.fn()
}));
vi.mock('@potatosalad775/eqcaps-device-bridge/browser', () => browser);

const client = vi.hoisted(() => ({
	loadIndex: vi.fn(),
	loadProfile: vi.fn(),
	matchDevice: vi.fn()
}));
vi.mock('#lib/services/eqcaps-client.js', () => ({ eqcapsClient: () => client }));

const { connectHid, connectNativeHid, connectSerial, guessedProfile } = await import('./connect');

/** An 8-band hardware profile (from modernGraphTool's spec fixtures). */
function hardwareProfile(id: string, opts: { bandCount: number }): Profile {
	return {
		schemaVersion: '1.0',
		id,
		kind: 'hardware',
		device: { brand: 'Spec', model: id },
		bandCount: opts.bandCount,
		band: {
			types: ['PK', 'LSC', 'HSC'],
			freq: { min: 20, max: 20000, step: 1 },
			q: { min: 0.1, max: 10, step: 0.01 },
			gain: { min: -12, max: 12, step: 0.1 }
		},
		preamp: { mode: 'manual', gain: { min: -12, max: 0, step: 0.5 } },
		meta: { status: 'community-verified', sources: [] }
	};
}

function hid(vendorId: number, productId: number, productName: string): HidTransport {
	return {
		kind: 'hid',
		vendorId,
		productId,
		productName,
		collections: [],
		sendReport: vi.fn(async () => {}),
		sendFeatureReport: vi.fn(async () => {}),
		receiveFeatureReport: vi.fn(async () => new Uint8Array()),
		onInputReport: () => () => {},
		close: vi.fn(async () => {})
	};
}

function entry(id: string, extra: Partial<IndexEntry> = {}): IndexEntry {
	return {
		id,
		kind: 'hardware',
		brand: 'Spec',
		model: id,
		status: 'draft',
		path: `profiles/${id}.json`,
		sha256: '',
		bytes: 0,
		protocol: { handler: 'walkplay-hid' },
		...extra
	};
}

const match = (e: IndexEntry, specificity = 3, group = false) => ({
	id: e.id,
	specificity,
	group,
	entry: e
});

beforeEach(() => {
	vi.clearAllMocks();
	client.loadIndex.mockResolvedValue({ profiles: [] });
	client.loadProfile.mockImplementation(async (id: string): Promise<Profile> =>
		hardwareProfile(id, { bandCount: 8 })
	);
});

describe('connectHid', () => {
	it('is cancelled when the chooser is closed', async () => {
		browser.requestHidDevice.mockResolvedValue(null);
		expect(await connectHid()).toEqual({ kind: 'cancelled' });
	});

	it('drives a matched device with its profile’s protocol and limits', async () => {
		const e = entry('crinear-protocol-micro');
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0xc20f, 'Protocol Micro'));
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });

		const result = await connectHid();
		expect(result.kind).toBe('connected');
		if (result.kind !== 'connected') return;
		expect(result.connection.name).toBe('Spec crinear-protocol-micro');
		expect(result.connection.profileSource).toBe('device');
		expect(result.connection.profileId).toBe('crinear-protocol-micro');
		expect(result.connection.profile.bandCount).toBe(8);
		expect(result.connection.connectionType).toBe('hid');
		expect(result.connection.device.capabilities.canWrite).toBe(true);
		expect(client.matchDevice).toHaveBeenCalledWith({
			usb: { vendorId: '0x3302', productId: '0xc20f', productName: 'Protocol Micro' }
		});
	});

	it('says a group match is one', async () => {
		const e = entry('walkplay-schemeno16-devices', { group: true });
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0x1234, 'Dongle'));
		client.matchDevice.mockResolvedValue({
			best: match(e, 3, true),
			matches: [match(e, 3, true)],
			ambiguous: false
		});
		const result = await connectHid();
		expect(result.kind === 'connected' && result.connection.profileSource).toBe('group');
	});

	it('asks which device it is when the match is a tie, then connects the pick', async () => {
		const a = entry('model-a');
		const b = entry('model-b');
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0x1, 'Twin'));
		client.matchDevice.mockResolvedValue({
			best: null,
			matches: [match(a), match(b)],
			ambiguous: true
		});

		const result = await connectHid();
		expect(result.kind).toBe('choose');
		if (result.kind !== 'choose') return;
		expect(result.candidates.map((c) => c.id)).toEqual(['model-a', 'model-b']);
		const done = await result.finish('model-b');
		expect(done.kind === 'connected' && done.connection.profileId).toBe('model-b');
	});

	describe('profiles that only the firmware tells apart', () => {
		const fosi = { handler: 'fosi-audio-usb-hid' } as const;
		const old = entry('ds3-8-band', {
			model: 'DS3',
			protocol: fosi,
			match: { firmware: { max: '1.4.15' } }
		});
		const current = entry('ds3', {
			model: 'DS3',
			protocol: fosi,
			match: { firmware: { min: '1.4.15' } }
		});
		const tie = { best: null, matches: [match(current), match(old)], ambiguous: true };

		/** A DS3 that answers Fosi's firmware command (0xA6) with `version`, BCD per part. */
		function ds3(version: number[] | null): HidTransport {
			const t = hid(0x152a, 0x889b, 'Fosi Audio DS3');
			t.receiveFeatureReport = vi.fn(async () =>
				version ? new Uint8Array([1, 0x77, 0xa6, ...version]) : new Uint8Array(63)
			);
			return t;
		}

		it('reads the firmware and connects the profile it falls in', async () => {
			browser.requestHidDevice.mockResolvedValue(ds3([0x01, 0x06, 0x10]));
			client.matchDevice.mockImplementation(async (identity: { firmware?: string }) =>
				identity.firmware === '1.6.10'
					? { best: match(current), matches: [match(current)], ambiguous: false }
					: tie
			);

			const result = await connectHid();
			expect(result.kind === 'connected' && result.connection.profileId).toBe('ds3');
			expect(client.matchDevice).toHaveBeenLastCalledWith({
				usb: { vendorId: '0x152a', productId: '0x889b', productName: 'Fosi Audio DS3' },
				firmware: '1.6.10'
			});
		});

		it('asks, saying which firmware each is for, when the device doesn’t say', async () => {
			browser.requestHidDevice.mockResolvedValue(ds3(null));
			client.matchDevice.mockResolvedValue(tie);

			const result = await connectHid();
			expect(result.kind).toBe('choose');
			if (result.kind !== 'choose') return;
			expect(result.candidates).toEqual([
				{ id: 'ds3', label: 'Spec DS3 (firmware ≥ 1.4.15)' },
				{ id: 'ds3-8-band', label: 'Spec DS3 (firmware < 1.4.15)' }
			]);
			expect(client.matchDevice).toHaveBeenCalledTimes(1);
		});
	});

	it('doesn’t ask for the firmware when no matched profile depends on it', async () => {
		const e = entry('crinear-protocol-micro');
		const t = hid(0x3302, 0xc20f, 'Protocol Micro');
		browser.requestHidDevice.mockResolvedValue(t);
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });

		expect((await connectHid()).kind).toBe('connected');
		expect(t.sendReport).not.toHaveBeenCalled();
		expect(t.sendFeatureReport).not.toHaveBeenCalled();
	});

	it('guesses a known vendor’s protocol, with limits from what it can carry', async () => {
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0x9999, 'Mystery DSP '));
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });

		const result = await connectHid();
		expect(result.kind).toBe('connected');
		if (result.kind !== 'connected') return;
		expect(result.connection.profileSource).toBe('guess');
		expect(result.connection.name).toBe('Mystery DSP');
		expect(result.connection.device.capabilities.experimental).toBe(true);
		expect(result.connection.profile.bandCount).toBeGreaterThan(0);
	});

	it('closes the device and reports it unsupported when nothing can drive it', async () => {
		const t = hid(0x1234, 0x5678, 'Keyboard');
		browser.requestHidDevice.mockResolvedValue(t);
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });

		const result = await connectHid();
		expect(result.kind).toBe('unsupported');
		expect(t.close).toHaveBeenCalled();
	});

	it('drives the device on its protocol’s own limits when the profile can’t be fetched', async () => {
		const e = entry('offline-profile');
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0x2, 'X'));
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });
		client.loadProfile.mockResolvedValue(null);
		const result = await connectHid();
		expect(result.kind === 'connected' && result.connection.profileSource).toBe('guess');
	});

	it('finds the same device again without the chooser', async () => {
		const e = entry('crinear-protocol-micro');
		browser.requestHidDevice.mockResolvedValue(hid(0x3302, 0xc20f, 'Protocol Micro'));
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });
		const result = await connectHid();
		if (result.kind !== 'connected') throw new Error('expected a connection');

		browser.grantedHidDevice.mockResolvedValue(hid(0x3302, 0xc20f, 'Protocol Micro'));
		const again = await result.connection.reopen?.();
		expect(again?.profileId).toBe('crinear-protocol-micro');
		expect(browser.grantedHidDevice).toHaveBeenCalledWith({
			vendorId: 0x3302,
			productId: 0xc20f,
			productName: 'Protocol Micro'
		});
	});

	it('waits for a device restarting to save, skipping its old handle, every time', async () => {
		const e = entry('tanchjim-fola');
		browser.requestHidDevice.mockResolvedValue(hid(0x31b2, 0x1123, 'TANCHJIM-FOLA'));
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });
		const result = await connectHid();
		if (result.kind !== 'connected') throw new Error('expected a connection');

		browser.waitForGrantedHidDevice.mockResolvedValue(hid(0x31b2, 0x1123, 'TANCHJIM-FOLA'));
		const onEvent = vi.fn();
		const again = await result.connection.reopen?.({ timeoutMs: 5000, onEvent });
		expect(browser.waitForGrantedHidDevice).toHaveBeenCalledWith(
			{ vendorId: 0x31b2, productId: 0x1123, productName: 'TANCHJIM-FOLA' },
			{ timeoutMs: 5000, ignoreCurrent: true, reuseAfterMs: 1500, onEvent }
		);
		// Reopened, it can be reopened again after the next save.
		const third = await again?.reopen?.({ timeoutMs: 5000 });
		expect(third?.profileId).toBe('tanchjim-fola');
		expect(browser.waitForGrantedHidDevice).toHaveBeenCalledTimes(2);
		expect(browser.grantedHidDevice).not.toHaveBeenCalled();
	});
});

describe('connectSerial', () => {
	it('asks which device an unmatched port is, offering only serial-driven profiles', async () => {
		const serialEntry = entry('jds-labs-element-iv', {
			protocol: { handler: 'jds-labs-usb-serial' }
		});
		const hidEntry = entry('hid-only');
		client.loadIndex.mockResolvedValue({ profiles: [serialEntry, hidEntry] });
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });
		const stream: StreamTransport = {
			kind: 'serial',
			write: vi.fn(async () => {}),
			read: vi.fn(async () => null),
			close: vi.fn(async () => {})
		};
		const open = vi.fn(async () => stream);
		browser.requestSerialPort.mockResolvedValue({ identity: {}, port: {}, open });

		const result = await connectSerial();
		expect(result.kind).toBe('choose');
		if (result.kind !== 'choose') return;
		expect(result.candidates.map((c) => c.id)).toEqual(['jds-labs-element-iv']);
		const done = await result.finish('jds-labs-element-iv');
		expect(done.kind).toBe('connected');
		expect(open).toHaveBeenCalledWith({ handler: 'jds-labs-usb-serial' });
	});
});

describe('guessedProfile', () => {
	it('takes band count, types and domains from the protocol’s write frames', () => {
		const p = guessedProfile({ handler: 'walkplay-hid' }, 'Dongle');
		expect(p.kind).toBe('hardware');
		expect(p.meta.status).toBe('draft');
		expect(p.band.types?.every((t) => ['PK', 'LSC', 'HSC'].includes(t))).toBe(true);
		expect(p.bandCount).toBeGreaterThan(0);
	});
});

describe('connectNativeHid', () => {
	// A walkplay-style descriptor: vendor collection, report 0x4B in and out.
	const DESCRIPTOR = btoa(
		String.fromCharCode(
			0x06,
			0x00,
			0xff,
			0x09,
			0x01,
			0xa1,
			0x01,
			0x85,
			0x4b,
			0x15,
			0x00,
			0x26,
			0xff,
			0x00,
			0x75,
			0x08,
			0x95,
			0x3f,
			0x09,
			0x01,
			0x81,
			0x02,
			0x09,
			0x01,
			0x91,
			0x02,
			0xc0
		)
	);

	function usb(over: Partial<NativeUsbDevice> = {}): NativeUsbDevice {
		return {
			deviceName: '/dev/bus/usb/001/002',
			vendorId: 0x3302,
			productId: 0xc20f,
			productName: 'Protocol Micro',
			manufacturerName: 'CrinEar',
			hasPermission: false,
			hidInterfaces: [3],
			...over
		};
	}

	function plugin(devices: NativeUsbDevice[], granted = true) {
		return {
			list: vi.fn(async () => ({ devices })),
			requestPermission: vi.fn(async () => ({ granted })),
			describe: vi.fn(async () => ({
				interfaces: [{ number: 3, claimed: true, endpoints: 2, reportDescriptor: DESCRIPTOR }]
			})),
			open: vi.fn(async () => ({ handle: 1, inputEndpoint: true, outputEndpoint: true })),
			sendReport: vi.fn(async () => {}),
			sendFeatureReport: vi.fn(async () => {}),
			receiveFeatureReport: vi.fn(async () => ({ data: '' })),
			close: vi.fn(async () => {}),
			addListener: vi.fn(async () => ({ remove: async () => {} }))
		} as unknown as DeviceIoPlugin & { [K in keyof DeviceIoPlugin]: ReturnType<typeof vi.fn> };
	}

	it('reports no device when nothing attached is known', async () => {
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });
		const keyboard = usb({ vendorId: 0x046d, productName: 'Keyboard' });
		const noHid = usb({ hidInterfaces: [] });
		expect(await connectNativeHid(plugin([keyboard, noHid]))).toEqual({ kind: 'no-device' });
	});

	it('asks for USB permission, then connects the one known device with its profile', async () => {
		const e = entry('crinear-protocol-micro');
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });
		const p = plugin([usb()]);

		const result = await connectNativeHid(p);
		expect(p.requestPermission).toHaveBeenCalledWith({ deviceName: '/dev/bus/usb/001/002' });
		expect(result.kind).toBe('connected');
		if (result.kind !== 'connected') return;
		expect(result.connection.profileId).toBe('crinear-protocol-micro');
		expect(result.connection.connectionType).toBe('hid');
		expect(result.connection.usbDeviceName).toBe('/dev/bus/usb/001/002');
		expect(client.matchDevice).toHaveBeenLastCalledWith({
			usb: { vendorId: '0x3302', productId: '0xc20f', productName: 'Protocol Micro' }
		});
	});

	it('treats a refused permission as a cancelled chooser', async () => {
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });
		const p = plugin([usb()], false);
		expect(await connectNativeHid(p)).toEqual({ kind: 'cancelled' });
		expect(p.open).not.toHaveBeenCalled();
	});

	it('asks which device when several known ones are attached', async () => {
		client.matchDevice.mockResolvedValue({ best: null, matches: [], ambiguous: false });
		const a = usb({ hasPermission: true });
		const b = usb({ deviceName: '/dev/bus/usb/001/003', productName: 'Other DSP' });
		const p = plugin([a, b]);

		const result = await connectNativeHid(p);
		expect(result.kind).toBe('choose');
		if (result.kind !== 'choose') return;
		expect(result.candidates.map((c) => c.label)).toEqual([
			'CrinEar Protocol Micro',
			'CrinEar Other DSP'
		]);
		const done = await result.finish('/dev/bus/usb/001/002');
		expect(done.kind === 'connected' && done.connection.profileSource).toBe('guess');
		expect(done.kind === 'connected' && done.connection.usbDeviceName).toBe('/dev/bus/usb/001/002');
		expect(p.requestPermission).not.toHaveBeenCalled();
	});

	it('reopens a device restarting to save when it attaches at a new path', async () => {
		const e = entry('crinear-protocol-micro');
		client.matchDevice.mockResolvedValue({ best: match(e), matches: [match(e)], ambiguous: false });
		const old = usb({ hasPermission: true });
		const p = plugin([old]);
		let attached: ((e: { device: NativeUsbDevice }) => void) | undefined;
		const remove = vi.fn(async () => {});
		p.addListener.mockImplementation(async (_event: string, l: typeof attached) => {
			attached = l;
			return { remove };
		});
		const result = await connectNativeHid(p);
		if (result.kind !== 'connected') throw new Error('expected a connection');

		const onEvent = vi.fn();
		const reopening = result.connection.reopen?.({ timeoutMs: 5000, onEvent });
		// The old path, still listed for a moment, is not the device back.
		await vi.waitFor(() => expect(p.list).toHaveBeenCalledTimes(2));
		expect(p.open).toHaveBeenCalledOnce();
		attached?.({ device: usb({ productName: 'Keyboard', deviceName: '/dev/bus/usb/001/004' }) });
		attached?.({ device: usb({ deviceName: '/dev/bus/usb/001/003' }) });
		const again = await reopening;
		expect(p.requestPermission).toHaveBeenCalledWith({ deviceName: '/dev/bus/usb/001/003' });
		expect(again?.usbDeviceName).toBe('/dev/bus/usb/001/003');
		expect(again?.reopen).toBeDefined();
		expect(onEvent).toHaveBeenCalledWith('connect');
		expect(remove).toHaveBeenCalled();
	});

	it('gives up on a device that does not come back in time', async () => {
		vi.useFakeTimers();
		try {
			const e = entry('crinear-protocol-micro');
			client.matchDevice.mockResolvedValue({
				best: match(e),
				matches: [match(e)],
				ambiguous: false
			});
			const p = plugin([usb({ hasPermission: true })]);
			const result = await connectNativeHid(p);
			if (result.kind !== 'connected') throw new Error('expected a connection');
			const reopening = result.connection.reopen?.({ timeoutMs: 5000 });
			await vi.advanceTimersByTimeAsync(5000);
			expect(await reopening).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
