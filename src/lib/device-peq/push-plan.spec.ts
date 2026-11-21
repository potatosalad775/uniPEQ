// Adapted from modernGraphTool src/lib/device-peq/push-plan.spec.ts @ 23ddc4dd.
import { describe, expect, it, vi } from 'vitest';
import type { Filter } from '@potatosalad775/eqcaps-core';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import type { EqFilter, EqState } from '#lib/eq/model.js';
import { bandsWritten, needsConfirmation, needsReview, planPush, readLayout } from './push-plan';
import type { PeqDevice } from './types';

const pk = (freq: number, gain: number, extra: Partial<EqFilter> = {}): EqFilter => ({
	type: 'PK',
	freq,
	q: 1,
	gain,
	...extra
});

const FIVE_BAND = hardwareProfile('five', {
	bandCount: 5,
	band: {
		types: ['PK'],
		freq: { min: 20, max: 20000, step: 1 },
		q: { min: 0.1, max: 10, step: 0.01 },
		gain: { min: -12, max: 12, step: 0.5 }
	}
});

const WRITES_PREAMP = { writesPreamp: true, perChannel: false };

const eq = (filters: EqFilter[], preamp: number): EqState => ({ filters, preamp });

describe('planPush', () => {
	it('sends every device band, filling unused ones with flat filters', () => {
		const plan = planPush(eq([pk(1000, 3)], -3), FIVE_BAND, WRITES_PREAMP);
		expect(plan.filters).toHaveLength(5);
		expect(plan.filters[0]).toEqual({ type: 'PK', freq: 1000, q: 1, gain: 3 });
		expect(plan.filters.slice(1).every((f) => f.gain === 0)).toBe(true);
		expect(plan.preamp).toBe(-3);
		expect(needsConfirmation(plan)).toBe(false);
	});

	it('lists every value it had to move instead of changing it silently', () => {
		const plan = planPush(eq([pk(1000, 14.2)], -14.5), FIVE_BAND, WRITES_PREAMP);
		expect(plan.changes).toContainEqual({
			kind: 'field',
			band: 1,
			field: 'gain',
			wanted: 14.2,
			written: 12
		});
		expect(plan.changes).toContainEqual({ kind: 'preamp', wanted: -14.5, written: -12 });
		expect(needsConfirmation(plan)).toBe(true);
	});

	it('reports a type the slot refuses', () => {
		const plan = planPush(eq([pk(100, 3, { type: 'LSC' })], -3), FIVE_BAND, WRITES_PREAMP);
		expect(plan.filters[0].type).toBe('PK');
		expect(plan.changes).toContainEqual({
			kind: 'field',
			band: 1,
			field: 'type',
			wanted: 'LSC',
			written: 'PK'
		});
	});

	it('reports bands that found no slot, by their place in the list', () => {
		const filters = [1, 2, 3, 4, 5, 6].map((g, i) => pk(100 * 2 ** i, g));
		const plan = planPush(eq(filters, -6), FIVE_BAND, WRITES_PREAMP);
		// The least significant band (smallest |gain|) is the one left out.
		expect(plan.changes).toContainEqual({ kind: 'dropped', band: 1 });
		expect(plan.filters).toHaveLength(5);
	});

	it('sends a list the device holds as it is, with nothing to confirm', () => {
		const plan = planPush(eq([pk(1000, 3), pk(4000, 1)], -3), FIVE_BAND, WRITES_PREAMP);
		expect(plan.filters.slice(0, 2)).toEqual([
			{ type: 'PK', freq: 1000, q: 1, gain: 3 },
			{ type: 'PK', freq: 4000, q: 1, gain: 1 }
		]);
		expect(plan.changes).toEqual([]);
		expect(needsConfirmation(plan)).toBe(false);
	});

	it('writes flat bands as they are, in list order', () => {
		const bands = [31, 62, 125, 250, 500];
		const plan = planPush(
			eq(
				bands.map((f, i) => pk(f, i === 0 ? 3 : 0, { q: 0.75 })),
				-3
			),
			FIVE_BAND,
			WRITES_PREAMP
		);
		expect(plan.filters.map((f) => [f.freq, f.q, f.gain])).toEqual(
			bands.map((f, i) => [f, 0.75, i === 0 ? 3 : 0])
		);
		expect(needsConfirmation(plan)).toBe(false);
	});

	it('leaves the preamp out where the protocol can’t write it, and warns of clipping', () => {
		const plan = planPush(eq([pk(1000, 3)], -3), FIVE_BAND, {
			writesPreamp: false,
			perChannel: false
		});
		expect(plan.preamp).toBeUndefined();
		expect(plan.clipRisk).toBe(true);
		// Shown before a button write, but not a reason for auto-write to pause.
		expect(needsConfirmation(plan)).toBe(true);
		expect(needsReview(plan)).toBe(false);
	});

	it('trusts a device that sets its own headroom', () => {
		const auto = hardwareProfile('auto', { bandCount: 5, preamp: { mode: 'auto' } });
		const plan = planPush(eq([pk(1000, 3)], -3), auto, WRITES_PREAMP);
		expect(plan.preamp).toBeUndefined();
		expect(plan.clipRisk).toBe(false);
	});

	it('does not count a band that was flat to begin with as dropped', () => {
		const plan = planPush(eq([pk(1000, 0), pk(2000, 3)], -3), FIVE_BAND, WRITES_PREAMP);
		expect(plan.changes.filter((c) => c.kind === 'dropped')).toEqual([]);
	});
});

describe('planPush with the device’s layout', () => {
	it('counts the device bands the list leaves empty', () => {
		expect(planPush(eq([pk(1000, 3)], 0), FIVE_BAND, WRITES_PREAMP).emptySlots).toBe(4);
		const full = [100, 200, 400, 800, 1600].map((f) => pk(f, 1));
		expect(planPush(eq(full, 0), FIVE_BAND, WRITES_PREAMP).emptySlots).toBe(0);
	});

	it('writes what the device held in each empty band, flat', () => {
		const held = [31, 62, 125, 250, 500].map((freq): Filter => ({
			type: 'PK',
			freq,
			q: 0.7,
			gain: 4
		}));
		const plan = planPush(eq([pk(1000, 3)], -3), FIVE_BAND, WRITES_PREAMP, { filters: held });
		expect(plan.filters.map((f) => [f.freq, f.q, f.gain])).toEqual([
			[1000, 1, 3],
			[62, 0.7, 0],
			[125, 0.7, 0],
			[250, 0.7, 0],
			[500, 0.7, 0]
		]);
		expect(needsConfirmation(plan)).toBe(false);
	});
});

describe('readLayout', () => {
	const HELD: (Filter | null)[] = [{ type: 'PK', freq: 100, q: 1, gain: 2 }, null];
	const device = () => ({ pull: vi.fn<PeqDevice['pull']>(async () => ({ filters: HELD })) });

	it('reads the preset the request reaches', async () => {
		const d = device();
		expect(await readLayout(d, { slot: 1 })).toEqual({ filters: HELD });
		expect(d.pull).toHaveBeenCalledWith({ slot: 1 });
	});

	it('reads nothing when the preset can’t be reached', async () => {
		const d = device();
		expect(await readLayout(d, null)).toBeNull();
		expect(d.pull).not.toHaveBeenCalled();
	});

	it('gives up quietly when the read fails', async () => {
		const d = device();
		d.pull.mockRejectedValue(new Error('timeout'));
		expect(await readLayout(d, {})).toBeNull();
	});
});

describe('planPush for a device that holds an EQ per channel', () => {
	const STEREO = { ...FIVE_BAND, channels: 'independent' as const };
	const APART = { writesPreamp: true, perChannel: true };

	it('sends the right channel with a linked EQ, the same as the left', () => {
		const plan = planPush(eq([pk(1000, 14.2)], -3), STEREO, APART);
		expect(plan.right).toEqual({
			filters: plan.filters,
			preamp: plan.preamp,
			emptySlots: plan.emptySlots
		});
		// One list for both: what had to change is said once, for no channel in particular.
		expect(plan.changes).toEqual([
			{ kind: 'field', band: 1, field: 'gain', wanted: 14.2, written: 12 }
		]);
	});

	it('plans each channel of an EQ set apart on its own, and names the channel of each change', () => {
		const plan = planPush(
			{ ...eq([pk(1000, 14.2)], -3), right: eq([pk(250, -2), pk(4000, 3)], -6) },
			STEREO,
			APART
		);
		expect(plan.filters[0]).toEqual({ type: 'PK', freq: 1000, q: 1, gain: 12 });
		expect(plan.preamp).toBe(-3);
		expect(plan.right?.filters.slice(0, 2)).toEqual([
			{ type: 'PK', freq: 250, q: 1, gain: -2 },
			{ type: 'PK', freq: 4000, q: 1, gain: 3 }
		]);
		expect(plan.right?.preamp).toBe(-6);
		expect(plan.right?.emptySlots).toBe(3);
		expect(plan.changes).toEqual([
			{ kind: 'field', band: 1, field: 'gain', wanted: 14.2, written: 12, channel: 'left' }
		]);
		expect(bandsWritten(plan)).toBe(2);
	});

	it('names a change in the right channel as the right’s', () => {
		const plan = planPush(
			{ ...eq([pk(1000, 3)], -3), right: eq([pk(1000, 3)], -14.5) },
			STEREO,
			APART
		);
		expect(plan.changes).toEqual([
			{ kind: 'preamp', wanted: -14.5, written: -12, channel: 'right' }
		]);
	});

	it('keeps each channel’s own layout in the bands it leaves empty', () => {
		const held = (q: number) =>
			[31, 62, 125, 250, 500].map((freq): Filter => ({ type: 'PK', freq, q, gain: 1 }));
		const plan = planPush(
			{ ...eq([pk(1000, 3)], -3), right: eq([pk(1000, 2)], -2) },
			STEREO,
			APART,
			{ filters: held(0.7), right: held(2) }
		);
		expect(plan.filters[1]).toEqual({ type: 'PK', freq: 62, q: 0.7, gain: 0 });
		expect(plan.right?.filters[1]).toEqual({ type: 'PK', freq: 62, q: 2, gain: 0 });
	});

	it('writes the left channel to both where the device drives them as one', () => {
		const apart = { ...eq([pk(1000, 3)], -3), right: eq([pk(1000, 14.2)], -3) };
		for (const [profile, caps] of [
			[FIVE_BAND, APART],
			[STEREO, WRITES_PREAMP]
		] as const) {
			const plan = planPush(apart, profile, caps);
			expect(plan.right).toBeUndefined();
			expect(plan.filters[0].gain).toBe(3);
			expect(plan.changes).toEqual([]);
		}
	});
});

describe('readLayout from a device that reads its channels apart', () => {
	it('keeps the right channel’s layout too', async () => {
		const left: (Filter | null)[] = [{ type: 'PK', freq: 100, q: 1, gain: 2 }];
		const right: (Filter | null)[] = [{ type: 'PK', freq: 200, q: 1, gain: 2 }];
		const device = {
			pull: vi.fn<PeqDevice['pull']>(async () => ({ filters: left, right: { filters: right } }))
		};
		expect(await readLayout(device, {})).toEqual({ filters: left, right });
	});
});
