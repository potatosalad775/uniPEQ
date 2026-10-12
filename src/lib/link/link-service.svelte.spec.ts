import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Change, EditOp, JoinerOptions } from 'peq-link/client';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqService } from '$lib/services/device-peq-service.svelte';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import { settingsStore } from '$lib/stores/settings-store.svelte';
import { CRASH_MARKER_KEY, linkStore } from './link-store.svelte';
import { linkService } from './link-service.svelte';

/** The joiner stands in for the client: no signaling, and the spec plays mGT through its handlers. */
const joiners = vi.hoisted(() => [] as FakeJoiner[]);

interface FakeJoiner {
	options: JoinerOptions;
	approved: boolean;
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
	eqStore.open([pk(100), pk(1000), pk(10000)], 0);
	devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
	return conn;
}

/** Joins, gets mGT's attested host, approves: what a user tapping "Link" does. */
function link(): FakeJoiner {
	expect(linkService.open('abcd-1234')).toBe(true);
	const joiner = joiners.at(-1)!;
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

		eqStore.open([pk(500)], 0);
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

	it('tells mGT when the device or its status changes', () => {
		connect();
		const joiner = link();
		const { device, status } = joiner.sent;
		devicePeqStore.isReading = true;
		flushSync();
		expect(joiner.sent.status).toBe(status + 1);
		devicePeqStore.setDisconnected();
		flushSync();
		expect(joiner.sent.device).toBe(device + 1);
		expect(joiner.options.handlers.device()).toBeNull();
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
