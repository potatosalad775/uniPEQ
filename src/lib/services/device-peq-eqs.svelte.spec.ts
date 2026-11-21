/**
 * A device with several EQs, end to end through the service: the list edits one of them at a time,
 * and switching is like pointing the app at another device. The device is a fake with a Qudelix
 * 5K's two EQs (`twoEqDevice`): its user EQ and a 20-band headphone EQ with its channels apart,
 * each on a preset or, after an edit saved nowhere, on none.
 */
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { bridgeError, twoEqDevice } from '#lib/device-peq/__fixtures__/two-eq.js';
import type { DeviceConnection } from '#lib/device-peq/types.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';

const connectHid = vi.hoisted(() => vi.fn());

vi.mock('@potatosalad775/eqcaps-device-bridge/browser', () => ({}));
vi.mock('#lib/services/eqcaps-client.js', () => ({ eqcapsClient: () => ({}) }));
vi.mock('#lib/device-peq/connect.js', async (actual) => ({
	...(await actual<typeof import('#lib/device-peq/connect.js')>()),
	connectHid
}));

const { devicePeqService } = await import('./device-peq-service.svelte');

async function connect(conn: DeviceConnection) {
	connectHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
	await devicePeqService.connect('hid');
}

/** The two-EQ device, connected, with the calls it saw while connecting forgotten. */
async function connected(opts: Parameters<typeof twoEqDevice>[0] = {}) {
	const device = twoEqDevice(opts);
	await connect(device.conn);
	device.calls.length = 0;
	return device;
}

const pushes = (calls: { op: string; eq: string | undefined }[]) =>
	calls.filter((c) => c.op === 'push');

beforeEach(() => {
	settingsStore.autoPushEnabled = false;
	settingsStore.writeWarning = false;
	eqStore.reset();
});

afterEach(async () => {
	await devicePeqService.disconnect();
	devicePeqStore.forget();
	devicePeqService.eqLeaving = null;
	settingsStore.autoPushEnabled = true;
	settingsStore.writeWarning = true;
});

describe('a device with two EQs', () => {
	it("starts on the profile's own EQ, its bands and presets, and lists both", async () => {
		const { state } = await connected();
		expect(devicePeqStore.eqs).toEqual([
			{ id: undefined, name: 'USR EQ', present: true },
			{ id: 'spk', name: 'SPK EQ', present: true }
		]);
		expect(devicePeqStore.eq).toBeUndefined();
		expect(eqStore.filters).toEqual(state.usr.filters);
		expect(eqConstraintStore.maxBands).toBe(10);
		expect(devicePeqStore.slots.map((s) => s.name)).toContain('Acoustic');
		expect(devicePeqStore.perChannel).toBe(false);
	});

	it('switches to the other EQ: every call names it, its bands are the list, no undo back', async () => {
		const { state, calls } = await connected();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.requestWrite();
		calls.length = 0;

		await devicePeqService.selectEq('spk');
		expect(devicePeqStore.eq).toBe('spk');
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((c) => c.eq === 'spk')).toBe(true);
		expect(calls.map((c) => c.op)).toEqual(
			expect.arrayContaining(['bandCount', 'currentSlot', 'eqEnabled', 'pull'])
		);
		// Its channels differ, so they open apart.
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.left.filters).toEqual(state.spk.left);
		expect(eqStore.channels.right.filters).toEqual(state.spk.right);
		expect(eqStore.canUndo).toBe(false);
		expect(devicePeqStore.inSync).toBe(true);
		expect(devicePeqStore.operation).toBeNull();
	});

	it("edits against the EQ's own band count, presets and channels", async () => {
		await connected();
		await devicePeqService.selectEq('spk');
		expect(eqConstraintStore.maxBands).toBe(20);
		expect(eqConstraintStore.profile.engine).toBe('SPK EQ');
		expect(devicePeqStore.slots.map((s) => s.name)).toEqual(['Flat', 'Custom #1', 'Custom #2']);
		expect(devicePeqStore.perChannel).toBe(true);

		await devicePeqService.selectEq(undefined);
		expect(eqConstraintStore.maxBands).toBe(10);
		expect(devicePeqStore.perChannel).toBe(false);
	});

	it('names the connection for the EQ on screen, where the name ends in the data’s EQ label', async () => {
		const device = twoEqDevice();
		await connect({ ...device.conn, name: 'Spec Two-EQ DAC · USR EQ' });
		expect(devicePeqStore.connection?.name).toBe('Spec Two-EQ DAC · USR EQ');
		await devicePeqService.selectEq('spk');
		expect(devicePeqStore.connection?.name).toBe('Spec Two-EQ DAC · SPK EQ');
	});

	it('leaves a name from elsewhere alone when the EQ changes', async () => {
		await connected();
		await devicePeqService.selectEq('spk');
		expect(devicePeqStore.connection?.name).toBe('Spec Two-EQ DAC');
	});

	it('writes the left and right apart to that EQ, by its id', async () => {
		const { state, calls } = await connected();
		await devicePeqService.selectEq('spk');
		calls.length = 0;
		eqStore.edit('right');
		eqStore.update(0, { gain: -6 });
		await devicePeqService.requestWrite();
		expect(pushes(calls)).toEqual([{ op: 'push', eq: 'spk' }]);
		expect(state.spk.right[0].gain).toBe(-6);
		expect(state.spk.left[0].gain).toBe(3);
		expect(state.usr.filters[0].gain).toBe(2);
	});

	it('sends the right channel and the EQ in the one write', async () => {
		const { conn } = await connected();
		await devicePeqService.selectEq('spk');
		const push = vi.spyOn(conn.device, 'push');
		eqStore.update(1, { gain: 1 });
		await devicePeqService.requestWrite();
		expect(push).toHaveBeenCalledWith(
			expect.objectContaining({ eq: 'spk', slot: 22, right: expect.anything() })
		);
	});

	it('says so while it switches, then what it read', async () => {
		await connected();
		const switching = devicePeqService.selectEq('spk');
		expect(devicePeqStore.operation).toBe('eq');
		expect(devicePeqService.sync?.text).toBe('Switching EQ…');
		await switching;
		expect(devicePeqStore.statusMessage).toBe(
			'Read 20 band(s) per channel, the left and right apart'
		);
	});
});

describe('changes not written when another EQ is picked', () => {
	it('asks, and Cancel stays with the changes', async () => {
		const { calls } = await connected();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.selectEq('spk');
		expect(devicePeqService.eqLeaving).toEqual({ to: 'spk' });
		expect(devicePeqStore.eq).toBeUndefined();

		await devicePeqService.leaveEq('cancel');
		expect(devicePeqService.eqLeaving).toBeNull();
		expect(devicePeqStore.eq).toBeUndefined();
		expect(eqStore.filters[0].gain).toBe(5);
		expect(calls.filter((c) => c.eq === 'spk')).toEqual([]);
	});

	it('Discard switches without writing, and the changes are not carried over', async () => {
		const { state, calls } = await connected();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.selectEq('spk');
		await devicePeqService.leaveEq('discard');
		expect(devicePeqStore.eq).toBe('spk');
		expect(pushes(calls)).toEqual([]);
		expect(state.usr.filters[0].gain).toBe(2);
		expect(eqStore.channels.left.filters).toEqual(state.spk.left);
		expect(devicePeqStore.hasUnwritten).toBe(false);
	});

	it('Write writes them to the EQ being left, then switches', async () => {
		const { state, calls } = await connected();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.selectEq('spk');
		await devicePeqService.leaveEq('write');
		expect(pushes(calls)).toEqual([{ op: 'push', eq: undefined }]);
		expect(state.usr.filters[0].gain).toBe(5);
		expect(devicePeqStore.eq).toBe('spk');
		expect(eqStore.channels.left.filters).toEqual(state.spk.left);
	});

	it('Write goes through the volume warning and the review, and switches once written', async () => {
		settingsStore.writeWarning = true;
		const { state } = await connected();
		eqStore.update(0, { gain: 30 });
		await devicePeqService.selectEq('spk');
		await devicePeqService.leaveEq('write');
		expect(devicePeqService.volumeWarning).toBe(true);
		await devicePeqService.answerVolumeWarning(true);
		expect(devicePeqService.review).not.toBeNull();
		expect(devicePeqStore.eq).toBeUndefined();

		await devicePeqService.confirmReview(true);
		expect(state.usr.filters[0].gain).toBe(12);
		expect(devicePeqStore.eq).toBe('spk');
	});

	it('Write that is turned down at the review stays', async () => {
		await connected();
		eqStore.update(0, { gain: 30 });
		await devicePeqService.selectEq('spk');
		await devicePeqService.leaveEq('write');
		await devicePeqService.confirmReview(false);
		expect(devicePeqStore.eq).toBeUndefined();
		expect(eqStore.filters[0].gain).toBe(30);
	});

	it('an edit waiting for auto-write is written to its EQ first, without asking', async () => {
		settingsStore.autoPushEnabled = true;
		const { state, calls } = await connected();
		eqStore.update(0, { gain: 5 });
		await vi.waitFor(() => expect(devicePeqStore.autoDueAt).not.toBeNull());
		await devicePeqService.selectEq('spk');
		expect(devicePeqService.eqLeaving).toBeNull();
		expect(pushes(calls)).toEqual([{ op: 'push', eq: undefined }]);
		expect(state.usr.filters[0].gain).toBe(5);
		expect(devicePeqStore.eq).toBe('spk');
	});

	it('auto-write writes the next edit to the EQ switched to', async () => {
		settingsStore.autoPushEnabled = true;
		const { calls } = await connected();
		await devicePeqService.selectEq('spk');
		await devicePeqService.writeNow();
		expect(pushes(calls)).toEqual([]);

		eqStore.update(0, { gain: 1 });
		await devicePeqService.writeNow();
		expect(pushes(calls)).toEqual([{ op: 'push', eq: 'spk' }]);
	});

	it('auto-write takes a switch for a new target, never for an edit to write', async () => {
		settingsStore.autoPushEnabled = true;
		const { conn } = await connected();
		await devicePeqService.selectEq('spk');
		expect(eqStore.linked).toBe(false);
		// The user EQ can't be read now, so nothing replaces the list: its channels become the left
		// one's, which the user EQ never held.
		const pull = conn.device.pull;
		conn.device.pull = (r) => (r?.eq ? pull(r) : Promise.reject(bridgeError('timeout')));
		await devicePeqService.selectEq(undefined);
		expect(eqStore.linked).toBe(true);
		flushSync();
		await Promise.resolve();
		expect(devicePeqStore.autoDueAt).toBeNull();
	});
});

describe('an EQ the device has only in some modes', () => {
	it('shows one the current mode lacks as absent, and never opens it', async () => {
		const { calls } = await connected({ single: true });
		expect(devicePeqStore.eqs[1]).toEqual({ id: 'spk', name: 'SPK EQ', present: false });
		// Single-EQ mode: the user EQ is the device's one 20-band EQ.
		expect(eqConstraintStore.maxBands).toBe(20);
		await devicePeqService.selectEq('spk');
		expect(devicePeqStore.eq).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("falls back to the profile's own EQ when the mode changes behind the app", async () => {
		const { state } = await connected();
		await devicePeqService.selectEq('spk');
		state.single = true;
		eqStore.update(0, { gain: 1 });
		await devicePeqService.requestWrite();
		await vi.waitFor(() => expect(devicePeqStore.eq).toBeUndefined());
		await vi.waitFor(() => expect(devicePeqStore.isBusy).toBe(false));
		expect(devicePeqStore.eqs[1].present).toBe(false);
		expect(eqConstraintStore.maxBands).toBe(20);
		expect(eqStore.filters).toEqual(state.all.filters);
		expect(devicePeqStore.statusIsError).toBe(false);
		expect(devicePeqStore.statusMessage).toBe(
			"SPK EQ isn't available in the device's current mode, so this is USR EQ. Read 20 band(s) from the device"
		);
	});

	it('Read follows the mode back: the EQ returns and the own EQ counts its bands again', async () => {
		const { state } = await connected({ single: true });
		expect(eqConstraintStore.maxBands).toBe(20);
		state.single = false;
		await devicePeqService.read();
		expect(devicePeqStore.eqs[1].present).toBe(true);
		expect(eqConstraintStore.maxBands).toBe(10);
		expect(eqStore.filters).toEqual(state.usr.filters);
		expect(devicePeqStore.statusIsError).toBe(false);
	});

	it('Read follows the mode away while the own EQ is on screen', async () => {
		const { state } = await connected();
		state.single = true;
		await devicePeqService.read();
		expect(devicePeqStore.eqs[1].present).toBe(false);
		expect(eqConstraintStore.maxBands).toBe(20);
		expect(eqStore.filters).toEqual(state.all.filters);
	});

	it('Read is an undo step, and asks nothing new of the EQ, while the mode stays', async () => {
		await connected();
		eqStore.update(0, { gain: 9 });
		await devicePeqService.read();
		expect(eqStore.canUndo).toBe(true);
	});

	it("keeps the EQ when another refusal isn't about it", async () => {
		const { conn } = await connected();
		await devicePeqService.selectEq('spk');
		vi.spyOn(conn.device, 'push').mockRejectedValueOnce(bridgeError('unsupported'));
		eqStore.update(0, { gain: 1 });
		await devicePeqService.requestWrite();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(devicePeqStore.eq).toBe('spk');
		expect(devicePeqStore.statusIsError).toBe(true);
	});

	it('treats another failure to answer as a failure, not an absence', async () => {
		const device = twoEqDevice();
		device.conn.device.currentSlot = async (eq) => {
			if (eq === 'spk') throw bridgeError('timeout');
			return 22;
		};
		await connect(device.conn);
		expect(devicePeqStore.eqs[1].present).toBe(true);
		await devicePeqService.selectEq('spk');
		expect(devicePeqStore.eq).toBeUndefined();
		expect(devicePeqStore.failure).toEqual({ op: 'eq', code: 'timeout' });
	});
});

describe('the EQ across connections', () => {
	it('carries changes over a reconnect only onto the same EQ', async () => {
		const first = await connected();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.disconnect();
		await connect(first.conn);
		expect(eqStore.filters[0].gain).toBe(5);
		expect(devicePeqStore.unwritten).toBe(true);

		await devicePeqService.selectEq('spk');
		await devicePeqService.leaveEq('discard');
		eqStore.update(0, { gain: 7 });
		await devicePeqService.disconnect();
		// Every connection starts on the profile's own EQ, which is read over the changes.
		const again = twoEqDevice();
		await connect(again.conn);
		expect(devicePeqStore.eq).toBeUndefined();
		expect(eqStore.filters).toEqual(again.state.usr.filters);
		expect(devicePeqStore.hasUnwritten).toBe(false);
	});

	it('keeps the EQ through a reopen while the device still has it', async () => {
		// The same device each time it is opened again; the third time, in single-EQ mode.
		const [first, back, single] = [twoEqDevice(), twoEqDevice(), twoEqDevice({ single: true })];
		first.conn.reopen = async () => back.conn;
		back.conn.reopen = async () => single.conn;
		await connect(first.conn);
		await devicePeqService.selectEq('spk');

		await devicePeqService.reconnect();
		expect(devicePeqStore.opened).toBe(back.conn);
		expect(devicePeqStore.eq).toBe('spk');
		expect(back.calls.filter((c) => c.op === 'pull')).toEqual([{ op: 'pull', eq: 'spk' }]);

		await devicePeqService.reconnect();
		expect(devicePeqStore.opened).toBe(single.conn);
		expect(devicePeqStore.eq).toBeUndefined();
		expect(devicePeqStore.eqs[1].present).toBe(false);
	});

	it('a device that goes away while on the other EQ is let go', async () => {
		const { conn } = twoEqDevice();
		let lose = () => {};
		conn.onLost = (listener) => ((lose = listener), () => {});
		await connect(conn);
		await devicePeqService.selectEq('spk');
		lose();
		await vi.waitFor(() => expect(devicePeqStore.connection).toBeNull());
		expect(devicePeqStore.knownDevice?.eq).toBe('spk');
	});
});

describe('an EQ on no stored preset', () => {
	/** The two-EQ device on no preset, connected, with what its reads and writes asked for. */
	async function unsaved() {
		const device = twoEqDevice({ preset: null });
		const pull = vi.spyOn(device.conn.device, 'pull');
		const push = vi.spyOn(device.conn.device, 'push');
		await connect(device.conn);
		return { ...device, pull, push };
	}

	it('is read where it is on connecting, naming no preset, and is what Device EQ shows', async () => {
		const { state, pull } = await unsaved();
		expect(pull.mock.calls).toEqual([[{}]]);
		expect(eqStore.filters).toEqual(state.usr.filters);
		expect(devicePeqStore.selection).toBe('unsaved');
		expect(devicePeqStore.inSync).toBe(true);
		expect(eqConstraintStore.editable).toBe(true);
	});

	it('is written where it is, naming no preset, and stays on none', async () => {
		const { state, push } = await unsaved();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.requestWrite();
		expect(push).toHaveBeenCalledOnce();
		expect(push.mock.calls[0][0]).not.toHaveProperty('slot');
		expect(state.usr.filters[0].gain).toBe(5);
		expect(state.preset.usr).toBeNull();
		expect(devicePeqStore.selection).toBe('unsaved');
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('is auto-written there too', async () => {
		settingsStore.autoPushEnabled = true;
		const { state, push } = await unsaved();
		eqStore.update(0, { gain: 4 });
		await devicePeqService.writeNow();
		expect(push.mock.calls.map(([request]) => request.slot)).toEqual([undefined]);
		expect(state.usr.filters[0].gain).toBe(4);
	});

	it('keeps changes not written over a reconnect, with Read and Write both offered', async () => {
		const { conn } = await unsaved();
		eqStore.update(0, { gain: 5 });
		await devicePeqService.disconnect();
		await connect(conn);
		expect(eqStore.filters[0].gain).toBe(5);
		expect(devicePeqStore.selection).toBe('unsaved');
		expect(devicePeqService.sync?.actions).toEqual(['read', 'write']);
	});

	it('is read where it is on reopening', async () => {
		const back = twoEqDevice({ preset: null });
		const { conn } = await unsaved();
		conn.reopen = async () => back.conn;
		const pull = vi.spyOn(back.conn.device, 'pull');
		await devicePeqService.reconnect();
		expect(devicePeqStore.opened).toBe(back.conn);
		expect(pull.mock.calls).toEqual([[{}]]);
		expect(devicePeqStore.selection).toBe('unsaved');
	});

	it("reads the other EQ's own where it is on switching to it", async () => {
		const { state, pull } = await unsaved();
		await devicePeqService.selectEq('spk');
		expect(pull.mock.calls.at(-1)).toEqual([{ eq: 'spk' }]);
		expect(eqStore.channels.left.filters).toEqual(state.spk.left);
		expect(eqStore.channels.right.filters).toEqual(state.spk.right);
		expect(devicePeqStore.selection).toBe('unsaved');
		expect(eqConstraintStore.editable).toBe(true);
	});

	it('loads a preset picked, then reads and writes it as any other', async () => {
		const { state, calls, push } = await unsaved();
		expect(devicePeqStore.selection).toBe('unsaved');
		calls.length = 0;
		await devicePeqService.switchTo('p23');
		expect(state.preset.usr).toBe(23);
		expect(calls.map((c) => c.op)).toEqual(['setEnabled', 'pull']);
		expect(devicePeqStore.selection).toBe(23);
		eqStore.update(0, { gain: 5 });
		await devicePeqService.requestWrite();
		expect(push.mock.calls.at(-1)?.[0]).toMatchObject({ slot: 23 });
	});

	it("Read follows the device off its preset after its own app's edit", async () => {
		const { state, conn } = await connected();
		expect(devicePeqStore.selection).toBe(22);
		state.usr = { filters: state.usr.filters.map((f) => ({ ...f, gain: 1 })), preamp: -1 };
		state.preset.usr = null;
		await devicePeqService.read();
		expect(devicePeqStore.selection).toBe('unsaved');
		expect(eqStore.filters).toEqual(state.usr.filters);

		const push = vi.spyOn(conn.device, 'push');
		eqStore.update(0, { gain: 5 });
		await devicePeqService.requestWrite();
		expect(push.mock.calls[0][0]).not.toHaveProperty('slot');
		expect(state.preset.usr).toBeNull();
	});

	it('Read follows the device onto a preset its own app loaded', async () => {
		const { state, conn } = await connected({ preset: null });
		state.preset.usr = 23;
		await devicePeqService.read();
		expect(devicePeqStore.selection).toBe(23);

		const push = vi.spyOn(conn.device, 'push');
		eqStore.update(0, { gain: 5 });
		await devicePeqService.requestWrite();
		expect(push.mock.calls[0][0]).toMatchObject({ slot: 23 });
	});

	// As before: the first listed preset (Flat, built in) is the target, which Read can't reach
	// and Write won't write.
	it.each([
		['the protocol only guesses it', { readsCurrentSlot: false }],
		['the EQ switch is a bypass preset', { readsEnabled: false }],
		['its reads name a preset', { readsSlot: true }]
	])('keeps a null preset unknown where %s', async (_, caps) => {
		const device = twoEqDevice({ preset: null });
		Object.assign(device.conn.device.capabilities, caps);
		await connect(device.conn);
		expect(devicePeqStore.selection).not.toBe('unsaved');
		expect(devicePeqStore.activeSlot).toBe(0);
		expect(devicePeqStore.writeTarget).toBeNull();
	});

	it('keeps a preset it failed to ask for unknown', async () => {
		const device = twoEqDevice({ preset: null });
		const asked = device.conn.device.currentSlot;
		device.conn.device.currentSlot = async (eq) => {
			if (eq === undefined) throw bridgeError('timeout');
			return asked(eq);
		};
		await connect(device.conn);
		expect(devicePeqStore.selection).toBe(0);
		expect(devicePeqStore.readTarget).toBeNull();
		expect(devicePeqStore.writeTarget).toBeNull();
		expect(device.calls.filter((c) => c.op === 'pull')).toEqual([]);
	});
});

describe('the band count the device reports', () => {
	/** A one-EQ device whose profile says 5 bands, reporting `count`. */
	async function reported(count: number | null, over: object = {}) {
		const conn = fakeConnection(
			{ ...hardwareProfile('dac', { bandCount: 5 }), ...over },
			{ readsBandCount: true }
		);
		conn.device.bandCount = async () => count;
		await connect(conn);
		return devicePeqStore.profile?.bandCount;
	}

	it('overrides a profile that says otherwise', async () => {
		expect(await reported(10)).toBe(10);
		expect(eqConstraintStore.maxBands).toBe(10);
	});

	it('leaves the profile when the device reports none', async () => {
		expect(await reported(null)).toBe(5);
	});

	it('leaves a profile that sets slots by index', async () => {
		expect(await reported(10, { bands: [{ index: 0, types: ['PK'] }] })).toBe(5);
	});
});

describe('a device with one EQ', () => {
	it('lists just the one, and the demo device still reads and writes', async () => {
		await devicePeqService.connect('demo');
		expect(devicePeqStore.eqs).toHaveLength(1);
		expect(devicePeqStore.eq).toBeUndefined();
		eqStore.update(0, { gain: 1 });
		await devicePeqService.requestWrite();
		expect(devicePeqStore.inSync).toBe(true);
	});
});
