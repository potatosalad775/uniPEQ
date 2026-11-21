/**
 * Left and right apart, end to end: the service reading and writing the demo device, which holds
 * an EQ per channel, through the real bridge; and a device with one EQ for both, which never sees a
 * right channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import type { DeviceConnection, PushRequest } from '#lib/device-peq/types.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import type { EqFilter } from '#lib/eq/model.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';

const connectHid = vi.hoisted(() => vi.fn());

vi.mock('@potatosalad775/eqcaps-device-bridge/browser', () => ({}));
vi.mock('#lib/services/eqcaps-client.js', () => ({ eqcapsClient: () => ({}) }));
vi.mock('#lib/device-peq/connect.js', async (actual) => ({
	...(await actual<typeof import('#lib/device-peq/connect.js')>()),
	connectHid
}));

const { resetDemoDac } = await import('#lib/device-peq/demo.js');
const { devicePeqService } = await import('./device-peq-service.svelte');

/** What the connected device holds now, as it reads it back. */
const held = () => devicePeqStore.connection!.device.pull({});

const band = (gain: number): EqFilter => ({ type: 'PK', freq: 1000, q: 1, gain });

beforeEach(() => {
	resetDemoDac();
	settingsStore.autoPushEnabled = false;
	eqStore.reset();
});

afterEach(async () => {
	await devicePeqService.disconnect();
	devicePeqStore.forget();
	settingsStore.autoPushEnabled = true;
});

describe('the demo device, which holds an EQ per channel', () => {
	it('opens alike channels as one list, and writes that list to both', async () => {
		await devicePeqService.connect('demo');
		expect(devicePeqStore.perChannel).toBe(true);
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters[0]).toEqual({ type: 'LSC', freq: 105, q: 0.7, gain: 4.5 });

		eqStore.update(1, { gain: 2 });
		await devicePeqService.requestWrite();
		const now = await held();
		expect(now.filters[1]?.gain).toBe(2);
		expect(now.right).toEqual({ filters: now.filters, preamp: now.preamp });
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('writes the right channel set apart, and reads the channels back apart', async () => {
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		expect(devicePeqStore.inSync).toBe(true);
		eqStore.update(0, { gain: -3 });
		eqStore.setPreamp(-2);
		expect(devicePeqStore.inSync).toBe(false);
		await devicePeqService.requestWrite();
		expect(devicePeqStore.inSync).toBe(true);

		const now = await held();
		expect(now.filters[0]?.gain).toBe(4.5);
		expect(now.preamp).toBe(-4.5);
		expect(now.right?.filters[0]?.gain).toBe(-3);
		expect(now.right?.preamp).toBe(-2);

		await devicePeqService.disconnect();
		eqStore.reset();
		await devicePeqService.connect('demo');
		expect(eqStore.linked).toBe(false);
		expect(eqStore.editing).toBe('left');
		expect(eqStore.channels.left.filters[0].gain).toBe(4.5);
		expect(eqStore.channels.right.filters[0].gain).toBe(-3);
		expect(eqStore.channels.right.manualPreamp).toBe(-2);
		expect(devicePeqStore.statusMessage).toBe(
			'Read 10 band(s) per channel, the left and right apart'
		);
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('links the channels again and writes both alike', async () => {
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		eqStore.update(0, { gain: -3 });
		await devicePeqService.requestWrite();

		eqStore.edit('both');
		expect(devicePeqStore.inSync).toBe(false);
		await devicePeqService.requestWrite();
		const now = await held();
		expect(now.filters[0]?.gain).toBe(-3);
		expect(now.right).toEqual({ filters: now.filters, preamp: now.preamp });

		await devicePeqService.read();
		expect(eqStore.linked).toBe(true);
	});

	it('reviews what the right channel can’t hold, naming the channel', async () => {
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		eqStore.update(0, { gain: 14 });
		await devicePeqService.requestWrite();
		expect(devicePeqService.review?.changes).toEqual([
			{ kind: 'field', band: 1, field: 'gain', wanted: 14, written: 12, channel: 'right' }
		]);
		await devicePeqService.confirmReview(true);
		expect((await held()).right?.filters[0]?.gain).toBe(12);
	});

	it('auto-writes an edit to the right channel', async () => {
		settingsStore.autoPushEnabled = true;
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		eqStore.update(0, { gain: -6 });
		// What the timer would run (the link's `settle` runs it at once).
		await devicePeqService.writeNow();
		expect(devicePeqStore.inSync).toBe(true);
		expect((await held()).right?.filters[0]?.gain).toBe(-6);
	});

	it('keeps the channels apart, read-only, across a disconnect', async () => {
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		eqStore.update(0, { gain: -3 });
		await devicePeqService.disconnect();
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.right.filters[0].gain).toBe(-3);

		// The same device again: what it never got isn't read over.
		await devicePeqService.connect('demo');
		expect(eqStore.channels.right.filters[0].gain).toBe(-3);
		expect(devicePeqStore.hasUnwritten).toBe(true);
	});
});

describe('a device with one EQ for both channels', () => {
	beforeEach(() => (settingsStore.writeWarning = false));
	afterEach(() => (settingsStore.writeWarning = true));

	function linkedDevice(over: Partial<DeviceConnection['device']['capabilities']> = {}) {
		const profile = hardwareProfile('dac', { bandCount: 2 });
		const conn = fakeConnection(profile, over);
		const push = vi.fn<(r: PushRequest) => Promise<{ reconnect: boolean }>>(async () => ({
			reconnect: false
		}));
		conn.device.push = push;
		// A right channel it might report is no channel of its own: the bridge drives one EQ.
		conn.device.pull = async () => ({
			filters: [band(1), band(2)],
			preamp: -2,
			right: { filters: [band(5), band(6)], preamp: -6 }
		});
		return { conn, push };
	}

	it('reads one list and writes it without a right channel, as before', async () => {
		const { conn, push } = linkedDevice();
		connectHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters).toEqual([band(1), band(2)]);

		eqStore.update(0, { gain: 3 });
		await devicePeqService.requestWrite();
		expect(push).toHaveBeenCalledOnce();
		expect(push.mock.calls[0][0]).not.toHaveProperty('right');
		expect(push.mock.calls[0][0].filters[0]).toEqual(band(3));
	});

	it('gets the left channel of an EQ set apart, and the status line says so', async () => {
		await devicePeqService.connect('demo');
		eqStore.edit('right');
		eqStore.update(0, { gain: -3 });
		await devicePeqService.disconnect();

		// One that can't be read: nothing replaces the list, so the left channel is what stays.
		const { conn } = linkedDevice({ canRead: false });
		connectHid.mockResolvedValueOnce({ kind: 'connected', connection: conn });
		await devicePeqService.connect('hid');
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters[0]).toEqual({ type: 'LSC', freq: 105, q: 0.7, gain: 4.5 });
		expect(eqStore.canUndo).toBe(false);
		expect(devicePeqStore.statusMessage).toBe(
			"Spec dac has one EQ for both channels, so the left channel's bands were kept."
		);
	});
});
