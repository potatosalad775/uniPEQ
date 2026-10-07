// Adapted from modernGraphTool src/lib/utils/eq-apo.spec.ts @ 23ddc4dd.
import { describe, expect, it } from 'vitest';
import { formatApo, parseApo } from './eq-apo';
import type { EqFilter } from './model';

const AUTOEQ = `Preamp: -6.3 dB
Filter 1: ON LSC Fc 105 Hz Gain 2.6 dB Q 0.70
Filter 2: ON PK Fc 2510 Hz Gain -3.2 dB Q 1.41
Filter 3: ON HSC Fc 10000 Hz Gain -1.5 dB Q 0.70
`;

describe('parseApo', () => {
	it('parses an AutoEq ParametricEQ.txt, preamp included', () => {
		expect(parseApo(AUTOEQ)).toEqual({
			preamp: -6.3,
			skipped: 0,
			filters: [
				{ type: 'LSC', freq: 105, gain: 2.6, q: 0.7 },
				{ type: 'PK', freq: 2510, gain: -3.2, q: 1.41 },
				{ type: 'HSC', freq: 10000, gain: -1.5, q: 0.7 }
			]
		});
	});

	it('adds up several Preamp lines, as APO does, and reports none as null', () => {
		expect(parseApo('Preamp: -3 dB\nPreamp: -1.5 dB').preamp).toBe(-4.5);
		expect(parseApo('Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 1').preamp).toBeNull();
	});

	it('leaves out an OFF band without counting it as skipped', () => {
		const text =
			'Filter 1: OFF PK Fc 1000 Hz Gain 3 dB Q 1\nFilter 2: ON PK Fc 2000 Hz Gain 1 dB Q 1';
		expect(parseApo(text)).toEqual({
			filters: [{ type: 'PK', freq: 2000, gain: 1, q: 1 }],
			preamp: null,
			skipped: 0
		});
	});

	it('accepts a decimal centre frequency and a filter line without a number', () => {
		expect(parseApo('Filter: ON PK Fc 105.5 Hz Gain 1 dB Q 1').filters[0].freq).toBe(105.5);
	});

	it('maps APO shorthand names onto eqcaps codes', () => {
		const text = ['LS', 'HS', 'LP', 'HP', 'PEQ']
			.map((t, i) => `Filter ${i + 1}: ON ${t} Fc 1000 Hz Gain 1 dB Q 1`)
			.join('\n');
		expect(parseApo(text).filters.map((f) => f.type)).toEqual(['LSC', 'HSC', 'LPQ', 'HPQ', 'PK']);
	});

	it('reads gainless types without a Gain, and passes and shelves without a Q', () => {
		const { filters } = parseApo(
			'Filter 1: ON NO Fc 50 Hz Q 30\nFilter 2: ON HP Fc 20 Hz\nFilter 3: ON LS Fc 100 Hz Gain 3 dB'
		);
		expect(filters).toEqual([
			{ type: 'NO', freq: 50, q: 30, gain: 0 },
			{ type: 'HPQ', freq: 20, q: 0.707, gain: 0 },
			{ type: 'LSC', freq: 100, q: 0.707, gain: 3 }
		]);
	});

	it('converts a bandwidth in octaves to Q', () => {
		const { filters } = parseApo('Filter 1: ON PK Fc 1000 Hz Gain 3 dB BW Oct 1');
		expect(filters[0].q).toBeCloseTo(1.4142, 4);
	});

	it('skips and counts lines it cannot represent rather than importing them as peaks', () => {
		const { filters, skipped } = parseApo(
			[
				'Filter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1',
				'Filter 2: ON LS 6dB Fc 100 Hz Gain 3 dB',
				'Filter 3: ON XYZ Fc 100 Hz Gain 3 dB Q 1',
				'Filter 4: ON PK Fc 1000 Hz Gain 3 dB'
			].join('\n')
		);
		expect(filters).toHaveLength(1);
		expect(skipped).toBe(3);
	});

	it('skips bands pinned to one ear and keeps shared ones', () => {
		const { filters, skipped } = parseApo(
			[
				'Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 1',
				'Channel: L',
				'Filter 2: ON PK Fc 200 Hz Gain 1 dB Q 1',
				'Channel: L R',
				'Filter 3: ON PK Fc 300 Hz Gain 1 dB Q 1',
				'Channel: R',
				'Filter 4: ON PK Fc 400 Hz Gain 1 dB Q 1',
				'Channel: ALL',
				'Filter 5: ON PK Fc 500 Hz Gain 1 dB Q 1'
			].join('\n')
		);
		expect(filters.map((f) => f.freq)).toEqual([100, 300, 500]);
		expect(skipped).toBe(2);
	});

	it('ignores directives, comments and blank lines, and handles CRLF', () => {
		const { filters, skipped } = parseApo(
			'# AutoEq\r\nDevice: Speakers\r\n\r\nInclude: other.txt\r\nFilter 1: ON PK Fc 1000 Hz Gain 1 dB Q 1\r\n'
		);
		expect(filters).toHaveLength(1);
		expect(skipped).toBe(0);
	});

	it('returns nothing for a file with no filter lines', () => {
		expect(parseApo('hello\nworld')).toEqual({ filters: [], preamp: null, skipped: 0 });
	});
});

describe('formatApo', () => {
	it('writes the preamp, then one numbered line per band', () => {
		const filters: EqFilter[] = [
			{ type: 'LSC', freq: 105, gain: 2.6, q: 0.7 },
			{ type: 'PK', freq: 2510.5, gain: -3.25, q: 1.414 },
			{ type: 'HPQ', freq: 20, gain: 0, q: 0.707 }
		];
		expect(formatApo(filters, -6.3)).toBe(
			[
				'Preamp: -6.3 dB',
				'Filter 1: ON LSC Fc 105 Hz Gain 2.6 dB Q 0.7',
				'Filter 2: ON PK Fc 2510.5 Hz Gain -3.25 dB Q 1.414',
				'Filter 3: ON HPQ Fc 20 Hz Q 0.707',
				''
			].join('\n')
		);
	});

	it('round-trips every type through parseApo', () => {
		const filters: EqFilter[] = (['PK', 'LSC', 'HSC', 'LPQ', 'HPQ', 'BP', 'NO', 'AP'] as const).map(
			(type, i) => ({
				type,
				freq: 100 * (i + 1),
				q: [0.5, 0.7, 1, 1.41, 2, 3, 4.5, 10][i],
				gain: ['PK', 'LSC', 'HSC'].includes(type) ? i - 3 : 0
			})
		);
		expect(parseApo(formatApo(filters, -2))).toEqual({ filters, preamp: -2, skipped: 0 });
	});
});
