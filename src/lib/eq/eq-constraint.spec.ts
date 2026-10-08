// Adapted from modernGraphTool src/lib/utils/eq-constraint.spec.ts @ 23ddc4dd.
import { describe, expect, it } from 'vitest';
import { graphicProfile, hardwareProfile, softwareProfile } from './__fixtures__/profiles';
import {
	appTypesOf,
	assignSlots,
	conformFilters,
	editFilter,
	filterViolations,
	fitFilters,
	flatBand,
	graphicBandsOf,
	isGraphicProfile,
	isPastMaxBands,
	maxBandsOf,
	newBand,
	padToBandCount,
	projectFilter,
	sameFilters
} from './eq-constraint';
import type { EqFilter } from './model';

const pk = (freq: number, gain: number, q = 1, extra: Partial<EqFilter> = {}): EqFilter => ({
	type: 'PK',
	freq,
	q,
	gain,
	...extra
});

const PARAM = softwareProfile('param', {
	maxBands: 3,
	types: ['PK'],
	freq: { min: 100, max: 10000 },
	q: { min: 0.5, max: 5 },
	gain: { min: -6, max: 6 }
});

const GRAPHIC = graphicProfile('graphic', [
	{ freq: 100, q: 1.4 },
	{ freq: 1000, q: 1.4 },
	{ freq: 10000, q: 1.4 }
]);

/** JDS-style: a low-shelf-only first slot, then peaking slots. */
const PARTITIONED = hardwareProfile('partitioned', {
	bandCount: 3,
	band: {
		types: ['PK'],
		freq: { min: 20, max: 20000 },
		q: { min: 0.1, max: 10 },
		gain: { min: -12, max: 12, step: 0.5 }
	},
	bands: [{ index: 0, types: ['LSC'], freq: { min: 20, max: 300 } }]
});

describe('filters', () => {
	it('lists the app types a slot takes, in its order, without x- types', () => {
		expect(appTypesOf(['HSC', 'x-vendor', 'LPQ', 'PK'])).toEqual(['HSC', 'LPQ', 'PK']);
	});
});

describe('reading profiles', () => {
	it('reads the band cap, 0 meaning unlimited', () => {
		expect(maxBandsOf(PARAM)).toBe(3);
		expect(maxBandsOf(softwareProfile('free'))).toBe(0);
	});

	it('recognizes a graphic EQ and lists its bands', () => {
		expect(isGraphicProfile(GRAPHIC)).toBe(true);
		expect(isGraphicProfile(PARAM)).toBe(false);
		expect(graphicBandsOf(GRAPHIC)).toEqual([
			{ freq: 100, q: 1.4 },
			{ freq: 1000, q: 1.4 },
			{ freq: 10000, q: 1.4 }
		]);
		expect(graphicBandsOf(PARAM)).toEqual([]);
	});
});

describe('projectFilter', () => {
	it('clamps every field into its range', () => {
		expect(projectFilter(pk(50, 9, 8), PARAM, 0)).toEqual(pk(100, 6, 5));
	});

	it('snaps onto a stepped grid', () => {
		expect(projectFilter(pk(1000, 3.3), PARTITIONED, 1).gain).toBe(3.5);
	});

	it('moves a disallowed type to the slot’s first type', () => {
		expect(projectFilter({ ...pk(1000, 3), type: 'HSC' }, PARAM, 0).type).toBe('PK');
		expect(projectFilter(pk(100, 3), PARTITIONED, 0).type).toBe('LSC');
	});

	it('locks frequency and Q on a graphic band', () => {
		const out = projectFilter(pk(900, 3, 4), GRAPHIC, 1);
		expect(out.freq).toBe(1000);
		expect(out.q).toBe(1.4);
	});
});

describe('assignSlots', () => {
	it('puts a low shelf in the low-shelf slot whatever its list position', () => {
		const filters = [pk(1000, 3), { ...pk(80, 4), type: 'LSC' as const }];
		expect(assignSlots(filters, PARTITIONED)).toEqual([1, 0]);
	});
});

describe('conformFilters', () => {
	it('trims to the band cap and projects what stays', () => {
		const out = conformFilters([pk(50, 9), pk(1000, 1), pk(2000, 2), pk(4000, 3)], PARAM);
		expect(out).toHaveLength(3);
		expect(out[0]).toEqual(pk(100, 6));
	});

	it('does not trim when unlimited', () => {
		const free = softwareProfile('free');
		expect(conformFilters([pk(100, 1), pk(200, 1), pk(400, 1), pk(800, 1)], free)).toHaveLength(4);
	});

	it('folds onto a graphic EQ: one row per band, nearest source gain within an octave', () => {
		const out = conformFilters([pk(950, 4), pk(9000, -3), pk(30, 5)], GRAPHIC);
		expect(out.map((f) => [f.freq, f.gain])).toEqual([
			[100, 0],
			[1000, 4],
			[10000, -3]
		]);
		expect(out.every((f) => f.type === 'PK' && f.q === 1.4)).toBe(true);
	});

	it('clamps folded gains to the graphic EQ’s gain range', () => {
		expect(conformFilters([pk(1000, 30)], GRAPHIC)[1].gain).toBe(10);
	});
});

describe('padToBandCount', () => {
	const DEVICE = hardwareProfile('device', {
		bandCount: 5,
		band: {
			types: ['PK'],
			freq: { min: 20, max: 20000, step: 1 },
			q: { min: 0.1, max: 10, step: 0.01 },
			gain: { min: -12, max: 12, step: 0.5 }
		}
	});

	it('appends flat bands in the widest log-frequency gaps until every device band has a row', () => {
		const out = padToBandCount([pk(1000, 3)], DEVICE);
		expect(out).toHaveLength(5);
		expect(out[0]).toEqual(pk(1000, 3));
		expect(out.slice(1).map((f) => [f.freq, f.q, f.gain])).toEqual([
			[80, 1, 0],
			[250, 1, 0],
			[2500, 1, 0],
			[8000, 1, 0]
		]);
	});

	it('fills an empty list with ascending nominal frequencies', () => {
		const eight = hardwareProfile('eight', { bandCount: 8, band: DEVICE.band });
		expect(padToBandCount([], eight).map((f) => f.freq)).toEqual([
			40, 100, 200, 400, 1000, 2000, 4000, 10000
		]);
	});

	it('keeps the order where nominal frequencies run out', () => {
		const narrow = hardwareProfile('narrow', {
			bandCount: 3,
			band: { ...DEVICE.band, freq: { min: 100, max: 140, step: 1 } }
		});
		expect(padToBandCount([], narrow).map((f) => f.freq)).toEqual([125, 132, 136]);
	});

	it('leaves software profiles, graphic EQs and full lists alone', () => {
		const five = [100, 200, 400, 800, 1600].map((f) => pk(f, 1));
		expect(padToBandCount(five, DEVICE)).toBe(five);
		expect(padToBandCount([pk(1000, 3)], PARAM)).toHaveLength(1);
		const graphic = hardwareProfile('geq', {
			bandCount: 2,
			band: { types: ['PK'], freq: { value: 100 }, q: { value: 1 }, gain: { min: -6, max: 6 } },
			bands: [{ index: 1, freq: { value: 1000 } }]
		});
		expect(padToBandCount([pk(100, 3)], graphic)).toHaveLength(1);
	});

	it('adds nothing a slot can only hold active', () => {
		const noZero = hardwareProfile('no-zero', {
			bandCount: 3,
			band: {
				types: ['PK'],
				freq: { min: 20, max: 20000 },
				q: { min: 0.1, max: 10 },
				gain: { min: 1, max: 6 }
			}
		});
		expect(padToBandCount([pk(1000, 3)], noZero)).toHaveLength(1);
	});
});

describe('filterViolations', () => {
	it('flags out-of-domain fields per band', () => {
		const v = filterViolations([pk(50, 3), pk(1000, 9)], PARAM);
		expect(v[0]).toEqual({ type: false, freq: true, q: false, gain: false });
		expect(v[1]).toEqual({ type: false, freq: false, q: false, gain: true });
	});

	it('flags a type no slot takes', () => {
		expect(filterViolations([{ ...pk(1000, 3), type: 'HSC' }], PARAM)[0].type).toBe(true);
	});

	it('flags an off-band frequency on a graphic EQ', () => {
		expect(filterViolations([pk(900, 3)], GRAPHIC)[0].freq).toBe(true);
	});
});

describe('isPastMaxBands', () => {
	it('flags indices past the cap', () => {
		expect(isPastMaxBands(2, PARAM)).toBe(false);
		expect(isPastMaxBands(3, PARAM)).toBe(true);
	});

	it('returns false when unlimited', () => {
		expect(isPastMaxBands(99, softwareProfile('free'))).toBe(false);
	});
});

describe('editFilter', () => {
	const p = hardwareProfile('h', { bandCount: 4 });
	const band: EqFilter = { type: 'PK', freq: 1000, q: 1, gain: 0 };

	it('projects the patched fields onto the slot', () => {
		expect(editFilter(band, { gain: 20, freq: 1000.4 }, p, 0)).toMatchObject({
			gain: 12,
			freq: 1000
		});
	});

	it('leaves the fields it was not asked to change alone, out of range or not', () => {
		const wild = { ...band, q: 50 };
		expect(editFilter(wild, { gain: 3 }, p, 0)).toMatchObject({ q: 50, gain: 3 });
	});
});

describe('newBand', () => {
	it('puts a flat peak in the widest gap, on a nominal frequency', () => {
		const p = softwareProfile('s');
		expect(newBand([], p)).toEqual({ type: 'PK', freq: 630, q: 1, gain: 0 });
		const lows: EqFilter[] = [
			{ type: 'PK', freq: 100, q: 1, gain: 0 },
			{ type: 'PK', freq: 200, q: 1, gain: 0 }
		];
		expect(newBand(lows, p).freq).toBe(2000);
	});

	it("takes the slot's own type where it has no peak", () => {
		const p = softwareProfile('s', { types: ['LSC', 'HSC'] });
		expect(newBand([], p).type).toBe('LSC');
	});
});

describe('flatBand', () => {
	it('makes a 0 dB peak at Q 1 where the band sits', () => {
		const p = hardwareProfile('h', { bandCount: 2 });
		const shelf: EqFilter = { type: 'LSC', freq: 105, q: 0.7, gain: 6 };
		expect(flatBand(shelf, p, 0)).toEqual({ type: 'PK', freq: 105, q: 1, gain: 0 });
	});

	it("takes the slot's own type where it has no peak", () => {
		const p = softwareProfile('s', { types: ['LSC', 'HSC'] });
		expect(flatBand({ type: 'HSC', freq: 8000, q: 0.7, gain: -3 }, p, 0)).toMatchObject({
			type: 'LSC',
			gain: 0
		});
	});
});

describe('fitFilters', () => {
	it('folds the list onto a device and fills its remaining bands flat', () => {
		const p = hardwareProfile('h', {
			bandCount: 3,
			band: {
				types: ['PK'],
				freq: { min: 20, max: 20000, step: 1 },
				q: { min: 0.1, max: 10, step: 0.01 },
				gain: { min: -12, max: 12, step: 0.1 }
			}
		});
		const out = fitFilters([{ type: 'LSC', freq: 100, q: 0.7, gain: 15 }], p);
		expect(out).toHaveLength(3);
		expect(out[0]).toMatchObject({ type: 'PK', gain: 12 });
		expect(out.slice(1).every((f) => f.gain === 0)).toBe(true);
	});

	it('changes nothing that already fits a software EQ', () => {
		const list: EqFilter[] = [{ type: 'PK', freq: 100, q: 1, gain: 3 }];
		expect(sameFilters(fitFilters(list, softwareProfile('s')), list)).toBe(true);
	});
});
