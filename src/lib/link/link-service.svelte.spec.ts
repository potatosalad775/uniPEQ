import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webLink, WEB_LINK_PARAM as CLIENT_WEB_LINK_PARAM } from 'peq-link/client';
import type { Change, EditOp, JoinerOptions } from 'peq-link/client';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { bridgeError, twoEqDevice } from '#lib/device-peq/__fixtures__/two-eq.js';
import { OWN_EQ } from '#lib/device-peq/device-eqs.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import { CRASH_MARKER_KEY, linkStore, WEB_LINK_PARAM } from './link-store.svelte';
import { linkService } from './link-service.svelte';

/** The joiner stands in for the client: no signaling, and the spec plays mGT through its handlers. */
const joiners = vi.hoisted(() => [] as FakeJoiner[]);

interface FakeJoiner {
	options: JoinerOptions;
	approved: boolean;
	/** The protocol minor both sides have: 3 is an mGT on protocol 1.3, 2 an older one. */
	minor: number;
	state: string;
	changes: Change[];
	sent: { device: number; status: number };
	on(type: string, listener: (value: unknown) => void): () => void;
	emit(type: string, value?: unknown): void;
}

vi.mock('peq-link/client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('peq-link/client')>();
	class Joiner implements FakeJoiner {
		approved = false;
		minor = 2;
		state = 'joining';
		changes: Change[] = [];
		sent = { device: 0, status: 0 };
		session = { on: () => () => {} };
		#listeners = new Map<string, ((value: unknown) => void)[]>();
		constructor(public options: JoinerOptions) {}
		on(type: string, listener: (value: unknown) => void) {
			this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
			return () => {};
		}
		emit(type: string, value?: unknown) {
			for (const listener of this.#listeners.get(type) ?? []) listener(value);
		}
		approve() {
			this.approved = true;
			this.state = 'linked';
			this.emit('state', 'linked');
		}
		deny() {
			this.#end('denied');
		}
		close(reason = 'unlink') {
			this.#end(reason);
		}
		#end(reason: string) {
			this.state = 'ended';
			this.emit('state', 'ended');
			this.emit('ended', { reason, by: 'self' });
		}
		changed(change: Change) {
			if (this.approved) this.changes.push(change);
		}
		sendDevice() {
			this.sent.device++;
		}
		sendStatus() {
			this.sent.status++;
		}
		notice() {}
		setForeground() {}
	}
	return {
		...actual,
		startJoiner: (options: JoinerOptions) => {
			const joiner = new Joiner(options);
			joiners.push(joiner);
			return joiner;
		}
	};
});

const PROFILE = hardwareProfile('dac', { bandCount: 3 });
const pk = (freq: number, gain = 0) => ({ type: 'PK' as const, freq, q: 1, gain });

function connect() {
	devicePeqService.install();
	const conn = fakeConnection(PROFILE);
	devicePeqStore.setConnected(conn, null);
	// The user lowered the volume: writes go out from here.
	devicePeqStore.writeConsent = true;
	eqStore.open({ filters: [pk(100), pk(1000), pk(10000)], preamp: 0 });
	devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
	return conn;
}

/**
 * Joins, gets mGT's attested host, approves: what a user tapping "Link" does. `minor` is what
 * mGT's `hello` settled on, before the session reads anything: 2 for an mGT older than protocol
 * 1.3, 3 for one that knows the channels, the device's EQs, settings and presets.
 */
function link(minor = 2): FakeJoiner {
	expect(linkService.open('abcd-1234')).toBe(true);
	const joiner = joiners.at(-1)!;
	joiner.minor = minor;
	joiner.emit('request', {
		host: { id: 'mgt', origin: 'https://squig.link', userAgent: '', joinedAt: 0 }
	});
	expect(linkStore.approval?.host).toBe('squig.link');
	linkService.approve();
	flushSync();
	return joiner;
}

function edit(joiner: FakeJoiner, ops: EditOp[], meta: { burst?: string; settle?: boolean } = {}) {
	const changed = joiner.options.handlers.edit(ops, { settle: false, ...meta });
	flushSync();
	return changed;
}

afterEach(() => {
	linkService.unlink();
	joiners.length = 0;
	devicePeqService.review = null;
	devicePeqService.eqLeaving = null;
	devicePeqStore.forget();
	eqStore.reset();
	settingsStore.autoPushEnabled = true;
	localStorage.removeItem(CRASH_MARKER_KEY);
});

describe('linkService', () => {
	it('joins a typed code on the default server, and refuses what is not a code', () => {
		expect(linkService.open('hello')).toBe(false);
		link();
		expect(joiners[0].options.server).toBe('https://link.unipeq.com');
		expect(joiners[0].options.room).toBe('ABCD1234');
		expect(linkStore.linked).toBe(true);
		expect(linkStore.host).toBe('squig.link');
		expect(localStorage.getItem(CRASH_MARKER_KEY)).toContain('ABCD1234');
	});

	it('joins the room in a web address, and hands back the address without it', () => {
		expect(WEB_LINK_PARAM).toBe(CLIENT_WEB_LINK_PARAM);
		const href = webLink('https://other.example', 'ABCD1234', 'https://app.example/uniPEQ/?tab=eq');
		expect(linkService.openAddress('https://app.example/uniPEQ/')).toBeNull();
		expect(linkService.openAddress(href)?.href).toBe('https://app.example/uniPEQ/?tab=eq');
		expect(joiners[0].options.server).toBe('https://other.example');
		expect(joiners[0].options.room).toBe('ABCD1234');
		expect(joiners[0].options.launch).toBeUndefined();
	});

	it("hands the launch token of mGT's own link back, and none for a typed code", () => {
		const token = 'ABCDEFGH23456789';
		const href = webLink('https://other.example', 'ABCD1234', 'https://app.example/', token);
		linkService.openAddress(href);
		expect(joiners[0].options.launch).toBe(token);
		linkService.open('WXYZ-5678');
		expect(joiners[1].options.launch).toBeUndefined();
	});

	it("applies mGT's edits as one undo step per burst, a band projected onto its slot", () => {
		connect();
		const joiner = link();
		expect(edit(joiner, [{ op: 'band', i: 1, filter: pk(1000, -3) }], { burst: 'g1' })).toBe(true);
		expect(edit(joiner, [{ op: 'band', i: 1, filter: pk(1200, 40) }], { burst: 'g1' })).toBe(true);
		// The profile's gain stops at 12 dB, as a local drag would.
		expect(eqStore.filters[1]).toEqual(pk(1200, 12));
		eqStore.undo();
		expect(eqStore.filters[1]).toEqual(pk(1000));
		expect(eqStore.canUndo).toBe(false);
		// A band past the end of the list changed shape under mGT: dropped.
		expect(edit(joiner, [{ op: 'band', i: 5, filter: pk(50) }])).toBe(false);
	});

	it('applies a list and a preamp in one message as one step', () => {
		connect();
		const joiner = link();
		edit(joiner, [
			{ op: 'list', filters: [pk(60, 4), { type: 'x-vendor', freq: 1, q: 1, gain: 0 }] },
			{ op: 'preamp', db: -4 }
		]);
		expect(eqStore.filters).toEqual([pk(60, 4)]);
		expect(eqStore.preamp).toBe(-4);
		eqStore.undo();
		expect(eqStore.filters).toHaveLength(3);
		expect(eqStore.preamp).toBe(0);
	});

	it('applies nothing while the list cannot be edited', () => {
		connect();
		const joiner = link();
		devicePeqStore.setDisconnected();
		expect(edit(joiner, [{ op: 'band', i: 0, filter: pk(200, 3) }])).toBe(false);
		expect(eqStore.filters[0]).toEqual(pk(100));
	});

	it("sends uniPEQ's own edits and fresh reads, never mGT's edits back", () => {
		connect();
		const joiner = link();
		edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 2) }], { burst: 'g1' });
		expect(joiner.changes).toEqual([]);

		eqStore.update(2, { gain: 5 });
		flushSync();
		expect(joiner.changes).toEqual([{ by: 'unipeq', burst: expect.any(String) }]);

		eqStore.open({ filters: [pk(500)], preamp: 0 });
		flushSync();
		expect(joiner.changes.at(-1)).toEqual({ by: 'device', fresh: true });
	});

	it('writes on settle from the handler, without waiting for the auto-write delay', async () => {
		const conn = connect();
		const push = vi.spyOn(conn.device, 'push');
		const joiner = link();
		edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 6) }], { burst: 'g1' });
		expect(devicePeqStore.autoDueAt).not.toBeNull();
		edit(joiner, [], { burst: 'g1', settle: true });
		await vi.waitFor(() => expect(push).toHaveBeenCalledOnce());
		expect(devicePeqStore.autoDueAt).toBeNull();
		expect(devicePeqStore.inSync).toBe(true);
	});

	it('shows the volume warning to mGT, holds writes, and writes on its answer', async () => {
		const conn = connect();
		devicePeqStore.writeConsent = false;
		const push = vi.spyOn(conn.device, 'push');
		const joiner = link();
		const { command, status } = joiner.options.handlers;
		expect(await command('write', undefined)).toEqual({ ok: true });
		edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 6) }], { burst: 'g1', settle: true });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(push).not.toHaveBeenCalled();
		expect(status().consent).toBe(true);

		expect(await command('consent', { accept: true })).toEqual({ ok: true });
		await vi.waitFor(() => expect(push).toHaveBeenCalled());
		expect(status().consent).toBe(false);
		expect(devicePeqStore.inSync).toBe(true);
		expect(await command('consent', { accept: true })).toEqual({ ok: false, code: 'no-consent' });
	});

	it('does not write on settle with auto-write off', async () => {
		const conn = connect();
		const push = vi.spyOn(conn.device, 'push');
		const joiner = link();
		devicePeqService.setAutoWrite(false);
		edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 6) }], { settle: true });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(push).not.toHaveBeenCalled();
	});

	it('shows a write that needs review to mGT, and plans again when the list moved', async () => {
		connect();
		const joiner = link();
		const { command, status } = joiner.options.handlers;
		// A band the device can't hold: the write has to be reviewed.
		eqStore.update(0, { gain: 20 });
		flushSync();
		expect(await command('write', undefined)).toEqual({ ok: true });
		const review = status().review;
		expect(review?.changes).toContainEqual(expect.objectContaining({ kind: 'field', band: 1 }));

		// mGT edits while the review is up: the plan is for a list no longer on screen.
		edit(joiner, [{ op: 'band', i: 1, filter: pk(1000, 1) }]);
		const stale = review!.rev;
		expect(await command('review', { rev: stale, accept: true })).toEqual({ ok: true });
		// Planned again for the list as it is now, not written.
		expect(status().review?.rev).toBeGreaterThan(stale);
		expect(devicePeqStore.inSync).toBe(false);

		expect(await command('review', { rev: status().review!.rev, accept: true })).toEqual({
			ok: true
		});
		expect(status().review).toBeNull();
		expect(devicePeqStore.inSync).toBe(true);
	});

	it("answers a failed command with the device's error code", async () => {
		const conn = connect();
		const joiner = link();
		vi.spyOn(conn.device, 'pull').mockRejectedValue(
			Object.assign(new Error('gone'), { name: 'BridgeError', code: 'timeout' })
		);
		expect(await joiner.options.handlers.command('read', undefined)).toEqual({
			ok: false,
			code: 'timeout'
		});
		expect(joiner.options.handlers.status().failure).toEqual({ op: 'read', code: 'timeout' });
	});

	it('refuses a device command as busy while another operation is under way', async () => {
		const conn = connect();
		const joiner = link();
		const pull = vi.spyOn(conn.device, 'pull');
		devicePeqStore.operation = 'write';
		expect(await joiner.options.handlers.command('read', undefined)).toEqual({
			ok: false,
			code: 'busy'
		});
		expect(pull).not.toHaveBeenCalled();
	});

	it('refuses a device command as busy while the device is being reconnected', async () => {
		const conn = connect();
		const joiner = link();
		const pull = vi.spyOn(conn.device, 'pull');
		devicePeqStore.isConnecting = true;
		expect(await joiner.options.handlers.command('read', undefined)).toEqual({
			ok: false,
			code: 'busy'
		});
		expect(pull).not.toHaveBeenCalled();
	});

	it('tells mGT when the device or its status changes', () => {
		connect();
		const joiner = link();
		const { device, status } = joiner.sent;
		devicePeqStore.operation = 'read';
		flushSync();
		expect(joiner.sent.status).toBe(status + 1);
		devicePeqStore.setDisconnected();
		flushSync();
		expect(joiner.sent.device).toBe(device + 1);
		expect(joiner.options.handlers.device()).toBeNull();
	});

	it("sends another of the device's EQs as a new device, with that EQ's profile and presets", async () => {
		devicePeqService.install();
		settingsStore.autoPushEnabled = false;
		devicePeqStore.setConnected(twoEqDevice().conn, 22);
		const joiner = link();
		const sent = joiner.sent.device;
		await devicePeqService.selectEq('spk');
		flushSync();
		expect(joiner.sent.device).toBe(sent + 1);
		expect(joiner.options.handlers.device()).toMatchObject({
			profile: { engine: 'SPK EQ', bandCount: 20 },
			capabilities: {
				slots: [{ name: 'Flat' }, { name: 'Custom #1' }, { name: 'Custom #2' }]
			}
		});
		// The list it shares is that EQ's, sent as a fresh start.
		expect(joiner.changes.at(-1)).toMatchObject({ fresh: true });
	});

	it('asks before replacing a link, and ends the old one as replaced', () => {
		const first = link();
		const ended = vi.fn();
		first.on('ended', ended);
		expect(linkService.open('WXYZ-5678')).toBe(true);
		joiners[1].emit('request', {
			host: { id: 'other', origin: 'https://graph.example', userAgent: '', joinedAt: 0 }
		});
		expect(linkStore.approval?.replaces).toBe('squig.link');
		linkService.approve();
		expect(ended).toHaveBeenCalledWith({ reason: 'replaced', by: 'self' });
		expect(linkStore.host).toBe('graph.example');
	});
});

/**
 * Protocol 1.3: the channels apart, and the device's EQs, settings and presets. The headphone EQ
 * of `twoEqDevice` drives its channels apart: its left starts +3 dB on the first four bands, its
 * right -3, both on a -9 dB preamp.
 */

/** The two-EQ device viewed as its headphone EQ, the left channel on screen, mGT on `minor`. */
async function apartDevice(minor = 3) {
	devicePeqService.install();
	settingsStore.autoPushEnabled = false;
	const device = twoEqDevice();
	devicePeqStore.setConnected(device.conn, 22);
	const joiner = link(minor);
	await devicePeqService.selectEq('spk');
	flushSync();
	expect(eqStore.linked).toBe(false);
	expect(eqStore.editing).toBe('left');
	return { joiner, device };
}

/** The two-EQ device on its own, one-channel user EQ, with its list as the device holds it. */
function userEqDevice(minor = 3) {
	devicePeqService.install();
	settingsStore.autoPushEnabled = false;
	const device = twoEqDevice();
	devicePeqStore.setConnected(device.conn, 22);
	const joiner = link(minor);
	const filters = Array.from({ length: 10 }, (_, i) => pk(100 * (i + 1)));
	eqStore.open({ filters, preamp: 0 });
	devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
	flushSync();
	return { joiner, device };
}

/**
 * A device that keeps a list of presets with names of its own, as a Topping DAC does: `names` held
 * out of `room`, a new one empty and the one played, a delete sending the device back to the first.
 */
function listDevice(names: string[], room = 4) {
	devicePeqService.install();
	settingsStore.autoPushEnabled = false;
	const held = names.map((name) => ({ name, filters: [pk(100)] }));
	let current = 0;
	const conn = fakeConnection(hardwareProfile('dac', { bandCount: 3 }), {
		canEnable: true,
		readsSlot: true,
		writesSlot: true,
		listsSlots: true,
		editsSlots: true,
		slots: Array.from({ length: room }, (_, id) => ({
			id,
			name: `Config ${id + 1}`,
			writable: true
		}))
	});
	const listed = () => held.map((h, id) => ({ id, name: h.name, writable: true }));
	const d = conn.device;
	d.slots = async () => listed();
	d.currentSlot = async () => current;
	d.setEnabled = async (_on, slot) => void (current = slot ?? current);
	d.pull = async (r) => ({ filters: held[r?.slot ?? current].filters, preamp: 0 });
	d.createSlot = async ({ name } = {}) => {
		if (name !== undefined && name.length > 15) throw bridgeError('invalid-request', 'too long');
		held.push({ name: name ?? `Config ${held.length + 1}`, filters: [] });
		current = held.length - 1;
		return listed()[current];
	};
	d.renameSlot = async (slot, name) => {
		if (name.length > 15) throw bridgeError('invalid-request', 'too long');
		held[slot].name = name;
	};
	d.deleteSlot = async (slot) => {
		held.splice(slot, 1);
		current = 0;
	};
	devicePeqStore.setConnected(conn, 0, null, listed());
	devicePeqStore.writeConsent = true;
	eqStore.open({ filters: [pk(100)], preamp: 0 });
	devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
	const joiner = link(3);
	return { joiner, conn, held };
}

const gains = (filters: { gain: number }[]) => filters.map((f) => f.gain);

describe('linkService with the channels apart', () => {
	it('shares both channels, the left at the top, whichever is on screen (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const { left, right } = eqStore.channels;
		const shared = joiner.options.handlers.eq();
		expect(shared.filters).toBe(left.filters);
		expect(shared.right?.filters).toBe(right.filters);
		expect(shared.preamp).toBe(-9);
		expect(shared.right?.preamp).toBe(-9);
		expect(shared.filters[0].gain).toBe(3);
		expect(shared.right?.filters[0].gain).toBe(-3);

		eqStore.edit('right');
		flushSync();
		expect(eqStore.filters).toBe(right.filters);
		const again = joiner.options.handlers.eq();
		expect(again.filters).toBe(left.filters);
		expect(again.right?.filters).toBe(right.filters);
	});

	it('shares the list on screen, without a right, for an mGT before 1.3', async () => {
		const { joiner } = await apartDevice(2);
		eqStore.edit('right');
		flushSync();
		const shared = joiner.options.handlers.eq();
		expect(shared.filters).toBe(eqStore.filters);
		expect(shared.filters[0].gain).toBe(-3);
		expect('right' in shared).toBe(false);
	});

	it('shares one list, without a right, while the channels are linked (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		eqStore.open({ filters: eqStore.filters, preamp: -9 });
		flushSync();
		expect(eqStore.linked).toBe(true);
		const shared = joiner.options.handlers.eq();
		expect(shared.filters).toBe(eqStore.filters);
		expect('right' in shared).toBe(false);
	});

	it('does not tell mGT of a switch between channels, which changed nothing for it (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const sent = joiner.changes.length;
		eqStore.edit('right');
		flushSync();
		eqStore.edit('left');
		flushSync();
		expect(joiner.changes).toHaveLength(sent);
		// An edit of a channel is still news.
		eqStore.update(0, { gain: 6 });
		flushSync();
		expect(joiner.changes).toHaveLength(sent + 1);
		expect(joiner.changes.at(-1)).toMatchObject({ by: 'unipeq' });
	});

	it('tells an mGT before 1.3 of a switch between channels: its list is the one on screen', async () => {
		const { joiner } = await apartDevice(2);
		const sent = joiner.changes.length;
		eqStore.edit('right');
		flushSync();
		expect(joiner.changes).toHaveLength(sent + 1);
		expect(joiner.changes.at(-1)).toMatchObject({ by: 'unipeq' });
	});

	it('sets both channels with an op that names none, a band projected as a local edit is (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const sent = joiner.changes.length;
		expect(edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 5) }], { burst: 'a' })).toBe(true);
		const { left, right } = eqStore.channels;
		expect(left.filters[0]).toEqual(pk(100, 5));
		expect(right.filters[0]).toEqual(pk(100, 5));
		// The rest is each channel's own.
		expect(gains(left.filters.slice(1, 4))).toEqual([3, 3, 3]);
		expect(gains(right.filters.slice(1, 4))).toEqual([-3, -3, -3]);
		expect(eqStore.linked).toBe(false);
		expect(eqStore.editing).toBe('left');
		// The profile's gain stops at 12 dB for each channel, as a local drag would.
		edit(joiner, [{ op: 'band', i: 1, filter: pk(200, 40) }], { burst: 'b' });
		expect(eqStore.channels.left.filters[1]).toEqual(pk(200, 12));
		expect(eqStore.channels.right.filters[1]).toEqual(pk(200, 12));
		// Nothing of mGT's own edits goes back to it.
		expect(joiner.changes).toHaveLength(sent);
	});

	it('sets only the channel an op names, the one off screen included, which stays off (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		expect(edit(joiner, [{ op: 'band', i: 0, ch: 'right', filter: pk(200, -6) }])).toBe(true);
		expect(eqStore.channels.right.filters[0]).toEqual(pk(200, -6));
		expect(eqStore.channels.left.filters[0].gain).toBe(3);
		expect(eqStore.editing).toBe('left');

		eqStore.edit('right');
		flushSync();
		expect(edit(joiner, [{ op: 'band', i: 1, ch: 'left', filter: pk(300, 7) }])).toBe(true);
		expect(eqStore.channels.left.filters[1]).toEqual(pk(300, 7));
		expect(eqStore.channels.right.filters[1].gain).toBe(-3);
		expect(eqStore.editing).toBe('right');
		// What is on screen is still the right one, untouched by the left's edit.
		expect(eqStore.filters[1].gain).toBe(-3);
	});

	it("sets a channel's list and preamp, and drops an x- type (1.3)", async () => {
		const { joiner } = await apartDevice(3);
		const x = { type: 'x-vendor', freq: 1, q: 1, gain: 0 };
		edit(joiner, [
			{ op: 'list', ch: 'right', filters: [pk(60, 4), x] },
			{ op: 'preamp', ch: 'left', db: -2 },
			{ op: 'auto-preamp', ch: 'right', on: true }
		]);
		const { left, right } = eqStore.channels;
		expect(right.filters).toEqual([pk(60, 4)]);
		expect(left.filters).toHaveLength(20);
		expect(left.autoPreamp).toBe(false);
		expect(left.manualPreamp).toBe(-2);
		expect(right.autoPreamp).toBe(true);
		// A band that is an x- type is dropped too.
		const before = eqStore.channels.left.filters;
		expect(edit(joiner, [{ op: 'band', i: 0, ch: 'left', filter: x }])).toBe(false);
		expect(eqStore.channels.left.filters).toBe(before);
	});

	it('is one undo step for a burst, with the channels as they were (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const { left, right } = eqStore.channels;
		edit(joiner, [{ op: 'band', i: 0, ch: 'right', filter: pk(200, -6) }], { burst: 'g' });
		edit(joiner, [{ op: 'band', i: 1, ch: 'left', filter: pk(300, 7) }], { burst: 'g' });
		expect(eqStore.channels.right.filters[0]).toEqual(pk(200, -6));
		expect(eqStore.channels.left.filters[1]).toEqual(pk(300, 7));
		eqStore.undo();
		expect(eqStore.channels.left.filters).toEqual(left.filters);
		expect(eqStore.channels.right.filters).toEqual(right.filters);
		expect(eqStore.canUndo).toBe(false);
	});

	it('drops an op that names a channel while one list drives both (1.3)', () => {
		connect();
		const joiner = link(3);
		const before = eqStore.filters;
		expect(edit(joiner, [{ op: 'band', i: 0, ch: 'left', filter: pk(100, 6) }])).toBe(false);
		expect(eqStore.filters).toBe(before);
		// The ops without one in the same message apply as they always do.
		expect(
			edit(joiner, [
				{ op: 'band', i: 0, ch: 'right', filter: pk(100, 6) },
				{ op: 'band', i: 1, filter: pk(1000, -3) }
			])
		).toBe(true);
		expect(eqStore.filters[0]).toEqual(pk(100));
		expect(eqStore.filters[1]).toEqual(pk(1000, -3));
		expect(eqStore.linked).toBe(true);
	});

	it('sets the channels apart, the right a copy of the left, where the device drives them apart', async () => {
		const { joiner } = await apartDevice(3);
		eqStore.open({ filters: eqStore.filters, preamp: -9 });
		flushSync();
		expect(eqStore.linked).toBe(true);
		expect(devicePeqStore.perChannel).toBe(true);
		const sent = joiner.changes.length;

		expect(edit(joiner, [{ op: 'channels', apart: true }], { burst: 's' })).toBe(true);
		expect(eqStore.linked).toBe(false);
		expect(eqStore.editing).toBe('left');
		expect(eqStore.channels.right.filters).toBe(eqStore.channels.left.filters);
		const shared = joiner.options.handlers.eq();
		expect(shared.right?.filters).toBe(shared.filters);
		expect(joiner.changes).toHaveLength(sent);
		// Again, it is already so: nothing changes.
		expect(edit(joiner, [{ op: 'channels', apart: true }])).toBe(false);

		eqStore.undo();
		expect(eqStore.linked).toBe(true);
		expect(eqStore.canUndo).toBe(false);
	});

	it('takes ops after a split in the same message as naming the channels it made (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		eqStore.open({ filters: eqStore.filters, preamp: -9 });
		flushSync();
		expect(
			edit(joiner, [
				{ op: 'channels', apart: true },
				{ op: 'band', i: 0, ch: 'right', filter: pk(100, -6) }
			])
		).toBe(true);
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.right.filters[0]).toEqual(pk(100, -6));
		expect(eqStore.channels.left.filters[0].gain).toBe(3);
	});

	it("refuses to set the channels apart where the device can't drive them apart (1.3)", () => {
		connect();
		const joiner = link(3);
		expect(devicePeqStore.perChannel).toBe(false);
		expect(edit(joiner, [{ op: 'channels', apart: true }])).toBe(false);
		expect(eqStore.linked).toBe(true);
		expect(joiner.options.handlers.eq()).not.toHaveProperty('right');
	});

	it('links the channels with the left list, or the right one with keep, as one step (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const { left, right } = eqStore.channels;
		expect(edit(joiner, [{ op: 'channels', apart: false }], { burst: 'l' })).toBe(true);
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters).toBe(left.filters);
		eqStore.undo();
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.left.filters).toEqual(left.filters);
		expect(eqStore.channels.right.filters).toEqual(right.filters);

		// Keep right, after the right's preamp was set in the same message.
		edit(
			joiner,
			[
				{ op: 'preamp', ch: 'right', db: -3 },
				{ op: 'channels', apart: false, keep: 'right' }
			],
			{ burst: 'r' }
		);
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters[0].gain).toBe(-3);
		expect(eqStore.preamp).toBe(-3);
		expect(eqStore.autoPreamp).toBe(false);
		eqStore.undo();
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.right.manualPreamp).toBe(-9);
		expect(eqStore.channels.left.filters).toEqual(left.filters);
		// Linked already: nothing changes.
		edit(joiner, [{ op: 'channels', apart: false }]);
		expect(edit(joiner, [{ op: 'channels', apart: false }])).toBe(false);
	});

	it('takes a band op that changes nothing as no edit and no undo step (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		const band = { op: 'band', i: 1, ch: 'left', filter: pk(200, 40) } as const;
		expect(edit(joiner, [band], { burst: 'a' })).toBe(true);
		// Past the 12 dB limit again: it lands where the band already is.
		expect(edit(joiner, [band], { burst: 'b' })).toBe(false);
		eqStore.undo();
		expect(eqStore.canUndo).toBe(false);
	});

	it('fits both channels for an mGT that shows both, as one step (1.3)', async () => {
		const { joiner } = await apartDevice(3);
		edit(joiner, [{ op: 'list', ch: 'right', filters: [pk(60, 40)] }]);
		const { left } = eqStore.channels;
		// The left, on screen, fits: uniPEQ's own Fit would have nothing to do.
		expect(eqConstraintStore.fitted).toBeNull();
		expect(await joiner.options.handlers.command('fit', undefined)).toEqual({ ok: true });
		const { right } = eqStore.channels;
		expect(right.filters).toHaveLength(20);
		expect(Math.max(...gains(right.filters))).toBeLessThanOrEqual(12);
		expect(eqStore.channels.left.filters).toEqual(left.filters);
		expect(eqStore.editing).toBe('left');
		eqStore.undo();
		expect(eqStore.channels.right.filters).toEqual([pk(60, 40)]);
	});

	it('follows a hello after approval, without taking its shape for an edit (1.3)', async () => {
		// Approved before mGT's hello: no minor yet, so one list.
		const { joiner } = await apartDevice(0);
		joiner.minor = 3;
		joiner.emit('hello', { t: 'hello', proto: [1, 3], app: 'mgt', version: '' });
		flushSync();
		const sent = joiner.changes.length;
		eqStore.edit('right');
		flushSync();
		eqStore.edit('left');
		flushSync();
		expect(joiner.changes).toHaveLength(sent);
		// Linking them leaves the list on screen as it was, but mGT showed two.
		eqStore.edit('both');
		flushSync();
		expect(joiner.changes).toHaveLength(sent + 1);
	});

	it('keeps an mGT before 1.3 on the channel on screen: an op without one edits only it', async () => {
		const { joiner } = await apartDevice(2);
		expect(edit(joiner, [{ op: 'band', i: 0, filter: pk(100, 5) }])).toBe(true);
		const { left, right } = eqStore.channels;
		expect(left.filters[0]).toEqual(pk(100, 5));
		expect(right.filters[0].gain).toBe(-3);
		expect(eqStore.linked).toBe(false);
		// What it can't say has no effect.
		expect(edit(joiner, [{ op: 'channels', apart: false }])).toBe(false);
		expect(eqStore.linked).toBe(false);
	});
});

describe('linkService describing the device (1.3)', () => {
	it("names the EQ the device is viewed as, and carries the device's settings and EQs", async () => {
		const { joiner } = await apartDevice(3);
		expect(joiner.options.handlers.device()).toMatchObject({
			eq: 'spk',
			capabilities: {
				perChannel: true,
				readsBandCount: true,
				eqs: [{ id: 'spk', name: 'SPK EQ' }],
				controls: expect.arrayContaining([expect.objectContaining({ id: 'headroom' })])
			}
		});
		await devicePeqService.selectEq(undefined);
		flushSync();
		const own = joiner.options.handlers.device();
		expect(own).toMatchObject({ eq: null, capabilities: { perChannel: false } });
	});

	it("lists the device's EQs, its own first and by name, while it is viewed as another (1.4)", async () => {
		const { joiner } = await apartDevice(3);
		expect(joiner.options.handlers.device()?.eqs).toEqual([
			{ id: null, name: 'USR EQ' },
			{ id: 'spk', name: 'SPK EQ' }
		]);
	});

	it("says the channels can't be set apart where uniPEQ wouldn't set them apart", () => {
		devicePeqService.install();
		devicePeqStore.setConnected(fakeConnection(PROFILE, { perChannel: true }), null);
		const joiner = link(3);
		expect(devicePeqStore.perChannel).toBe(false);
		expect(joiner.options.handlers.device()).toMatchObject({
			capabilities: { perChannel: false }
		});
	});

	it('says which presets are the device to list and edit, where it keeps a list', () => {
		const { joiner } = listDevice(['Bass']);
		expect(joiner.options.handlers.device()).toMatchObject({
			eq: null,
			capabilities: { listsSlots: true, editsSlots: true }
		});
	});
});

describe('linkService status (1.3)', () => {
	it('says the device is on no preset, rather than unknown, and its absent EQs', () => {
		const device = twoEqDevice();
		devicePeqService.install();
		devicePeqStore.setConnected(device.conn, 22, null, null, OWN_EQ, ['spk']);
		const joiner = link(3);
		const { status } = joiner.options.handlers;
		expect(status()).toMatchObject({ unsaved: false, deviceSlot: 22, absentEqs: ['spk'] });
		expect('slots' in status()).toBe(false);

		devicePeqStore.deviceSlot = 'unsaved';
		expect(status()).toMatchObject({ unsaved: true, deviceSlot: null });
	});

	it('names the operation under way: a setting, a preset, an EQ switch', () => {
		connect();
		const { status } = link(3).options.handlers;
		devicePeqStore.operation = 'control';
		expect(status().busy).toBe('control');
		devicePeqStore.operation = 'preset';
		expect(status().busy).toBe('preset');
		devicePeqStore.operation = 'eq';
		expect(status().busy).toBe('switch');
		devicePeqStore.operation = 'write';
		expect(status().busy).toBe('write');
		devicePeqStore.operation = 'switch';
		expect(status().busy).toBe('switch');
	});

	it("tells mGT when the device's settings change", () => {
		const { joiner } = userEqDevice();
		const sent = joiner.sent.status;
		devicePeqStore.controlValues = { gain: 1 };
		flushSync();
		expect(joiner.options.handlers.status().controls).toEqual({ gain: 1 });
		expect(joiner.sent.status).toBeGreaterThan(sent);
	});
});

describe('linkService commands (1.3)', () => {
	describe('eq', () => {
		it('does no work for the EQ the device is on already, and refuses one it lacks', async () => {
			const { joiner, device } = userEqDevice();
			const { command } = joiner.options.handlers;
			expect(await command('eq', { id: null })).toEqual({ ok: true });
			expect(await command('eq', { id: 'nope' })).toEqual({ ok: false, code: 'invalid-request' });
			expect(device.calls).toEqual([]);
			expect(devicePeqStore.eq).toBeUndefined();
		});

		it("refuses an EQ the device's mode lacks", async () => {
			const device = twoEqDevice({ single: true });
			devicePeqService.install();
			devicePeqStore.setConnected(device.conn, 22, null, null, OWN_EQ, ['spk']);
			const { command } = link(3).options.handlers;
			expect(await command('eq', { id: 'spk' })).toEqual({ ok: false, code: 'unsupported' });
			expect(device.calls).toEqual([]);
		});

		it('says no without a device', async () => {
			const { command } = link(3).options.handlers;
			expect(await command('eq', { id: 'spk' })).toEqual({ ok: false, code: 'no-device' });
		});

		it('says busy while something else is under way', async () => {
			const { joiner } = userEqDevice();
			const { command } = joiner.options.handlers;
			devicePeqStore.operation = 'read';
			expect(await command('eq', { id: 'spk' })).toEqual({ ok: false, code: 'busy' });
			devicePeqStore.operation = null;
			devicePeqStore.isConnecting = true;
			expect(await command('eq', { id: 'spk' })).toEqual({ ok: false, code: 'busy' });
			expect(devicePeqStore.eq).toBeUndefined();
		});

		it('says unwritten, and opens no dialog, while the list holds changes the device lacks', async () => {
			const { joiner, device } = userEqDevice();
			eqStore.update(0, { gain: 5 });
			flushSync();
			expect(devicePeqStore.hasUnwritten).toBe(true);
			expect(await joiner.options.handlers.command('eq', { id: 'spk' })).toEqual({
				ok: false,
				code: 'unwritten'
			});
			expect(devicePeqService.eqLeaving).toBeNull();
			expect(devicePeqStore.eq).toBeUndefined();
			expect(eqStore.filters[0].gain).toBe(5);
			expect(device.calls.filter((c) => c.eq === 'spk')).toEqual([]);
		});

		it('switches, and sends the new device and a fresh list, when nothing is unwritten', async () => {
			const { joiner } = userEqDevice();
			const sent = joiner.sent.device;
			expect(await joiner.options.handlers.command('eq', { id: 'spk' })).toEqual({ ok: true });
			flushSync();
			expect(devicePeqStore.eq).toBe('spk');
			expect(joiner.sent.device).toBe(sent + 1);
			expect(joiner.options.handlers.device()).toMatchObject({ eq: 'spk' });
			expect(joiner.changes.at(-1)).toEqual({ by: 'device', fresh: true });
			expect(joiner.options.handlers.eq().right).toBeDefined();
		});

		it("switches back to the device's own EQ with a null id", async () => {
			const { joiner } = userEqDevice();
			const { command } = joiner.options.handlers;
			expect(await command('eq', { id: 'spk' })).toEqual({ ok: true });
			expect(await command('eq', { id: null })).toEqual({ ok: true });
			flushSync();
			expect(devicePeqStore.eq).toBeUndefined();
			expect(joiner.options.handlers.device()).toMatchObject({ eq: null });
			expect(eqStore.linked).toBe(true);
			expect(joiner.options.handlers.eq()).not.toHaveProperty('right');
		});
	});

	describe('control', () => {
		it("refuses a control the device doesn't have, and writes one it does", async () => {
			const { joiner, device } = userEqDevice();
			const { command, status } = joiner.options.handlers;
			expect(await command('control', { id: 'nope', value: 1 })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(device.state.controls.gain).toBe(0);

			expect(await command('control', { id: 'gain', value: 1 })).toEqual({ ok: true });
			expect(device.state.controls.gain).toBe(1);
			expect(status().controls).toMatchObject({ gain: 1 });
		});

		it("answers the device's refusal with its code", async () => {
			const { joiner, device } = userEqDevice();
			device.state.enabled.usr = false;
			expect(
				await joiner.options.handlers.command('control', { id: 'crossfeed', value: 10 })
			).toEqual({ ok: false, code: 'rejected' });
		});

		it('refuses while the device must be reconnected, and says busy while it is', async () => {
			const { joiner, device } = userEqDevice();
			const { command } = joiner.options.handlers;
			devicePeqStore.needsReconnect = true;
			expect(await command('control', { id: 'gain', value: 1 })).toEqual({
				ok: false,
				code: 'not-editable'
			});
			devicePeqStore.needsReconnect = false;
			devicePeqStore.isConnecting = true;
			expect(await command('control', { id: 'gain', value: 1 })).toEqual({
				ok: false,
				code: 'busy'
			});
			expect(device.state.controls.gain).toBe(0);
		});

		it('refuses args it cannot read rather than fail', async () => {
			const { joiner } = userEqDevice();
			const { command } = joiner.options.handlers;
			const refused = { ok: false, code: 'invalid-request' };
			expect(await command('control', undefined as never)).toEqual(refused);
			expect(await command('control', { id: 'gain', value: '1' } as never)).toEqual(refused);
			expect(await command('eq', { id: 5 } as never)).toEqual(refused);
		});
	});

	describe('presets', () => {
		it("refuses where the device's presets are fixed, and without a device", async () => {
			const { command } = link(3).options.handlers;
			expect(await command('preset-create', {})).toEqual({ ok: false, code: 'no-device' });
			connect();
			expect(await command('preset-create', {})).toEqual({ ok: false, code: 'unsupported' });
			expect(await command('preset-rename', { slot: 0, name: 'x' })).toEqual({
				ok: false,
				code: 'unsupported'
			});
			expect(await command('preset-delete', { slot: 0 })).toEqual({
				ok: false,
				code: 'unsupported'
			});
		});

		it('creates a preset, named if mGT gave a name, and refuses when there is no room', async () => {
			const { joiner } = listDevice(['Bass', 'Airy', 'Warm']);
			const { command, status } = joiner.options.handlers;
			expect(await command('preset-create', { name: 'Vocal' })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Airy', 'Warm', 'Vocal']);
			// Four of four.
			expect(await command('preset-create', {})).toEqual({ ok: false, code: 'rejected' });
			expect(status().slots).toHaveLength(4);
		});

		it('creates a preset the device names when mGT gave none', async () => {
			const { joiner } = listDevice(['Bass']);
			expect(await joiner.options.handlers.command('preset-create', {})).toEqual({ ok: true });
			expect(joiner.options.handlers.status().slots?.map((s) => s.name)).toEqual([
				'Bass',
				'Config 2'
			]);
		});

		it("refuses a name the device can't store, and makes no preset", async () => {
			const { joiner } = listDevice(['Bass']);
			const { command, status } = joiner.options.handlers;
			expect(await command('preset-create', { name: 'a name far too long' })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass']);
		});

		it('says a preset was made, though what follows it fails', async () => {
			const { joiner, conn } = listDevice(['Bass']);
			vi.spyOn(conn.device, 'pull').mockRejectedValue(bridgeError('timeout', 'gone'));
			const { command, status } = joiner.options.handlers;
			expect(await command('preset-create', { name: 'Vocal' })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Vocal']);
			expect(status().failure).toMatchObject({ code: 'timeout' });
		});

		it("keeps mGT's name for the preset while the volume warning waits", async () => {
			const { joiner } = listDevice(['Bass']);
			devicePeqStore.writeConsent = false;
			const { command, status } = joiner.options.handlers;
			expect(await command('preset-create', { name: 'Vocal' })).toEqual({ ok: true });
			expect(status().consent).toBe(true);
			expect(status().slots).toHaveLength(1);
			expect(await command('consent', { accept: true })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Vocal']);
		});

		it('refuses a blank name and args it cannot read, as uniPEQ would', async () => {
			const { joiner, conn } = listDevice(['Bass', 'Airy']);
			const rename = vi.spyOn(conn.device, 'renameSlot');
			const { command, status } = joiner.options.handlers;
			const refused = { ok: false, code: 'invalid-request' };
			expect(await command('preset-rename', { slot: 1, name: '   ' })).toEqual(refused);
			expect(await command('preset-rename', undefined as never)).toEqual(refused);
			expect(await command('preset-delete', undefined as never)).toEqual(refused);
			expect(await command('preset-create', { name: 5 } as never)).toEqual(refused);
			expect(rename).not.toHaveBeenCalled();
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Airy']);
			// A blank name for a new one leaves it to the device.
			expect(await command('preset-create', { name: '  ' })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Airy', 'Config 3']);
		});

		it('refuses while the device must be reconnected, and says busy while it is', async () => {
			const { joiner, held } = listDevice(['Bass', 'Airy']);
			const { command } = joiner.options.handlers;
			const refused = { ok: false, code: 'not-editable' };
			devicePeqStore.needsReconnect = true;
			expect(await command('preset-create', {})).toEqual(refused);
			expect(await command('preset-rename', { slot: 1, name: 'Warm' })).toEqual(refused);
			expect(await command('preset-delete', { slot: 1 })).toEqual(refused);
			devicePeqStore.needsReconnect = false;
			devicePeqStore.isConnecting = true;
			expect(await command('preset-rename', { slot: 1, name: 'Warm' })).toEqual({
				ok: false,
				code: 'busy'
			});
			expect(held.map((h) => h.name)).toEqual(['Bass', 'Airy']);
		});

		it('renames a preset, and says why when the device refuses the name', async () => {
			const { joiner } = listDevice(['Bass', 'Airy']);
			const { command, status } = joiner.options.handlers;
			const before = status().slots;
			expect(await command('preset-rename', { slot: 9, name: 'x' })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(await command('preset-rename', { slot: 1, name: 'a name far too long' })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(status().slots).toEqual(before);

			expect(await command('preset-rename', { slot: 1, name: 'Warm' })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass', 'Warm']);
			expect(status().slots).not.toEqual(before);
		});

		it('deletes a preset, but not an unknown one or the last', async () => {
			const { joiner } = listDevice(['Bass', 'Airy']);
			const { command, status } = joiner.options.handlers;
			expect(await command('preset-delete', { slot: 9 })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(await command('preset-delete', { slot: 1 })).toEqual({ ok: true });
			expect(status().slots?.map((s) => s.name)).toEqual(['Bass']);
			expect(await command('preset-delete', { slot: 0 })).toEqual({
				ok: false,
				code: 'invalid-request'
			});
			expect(status().slots).toHaveLength(1);
		});
	});
});
