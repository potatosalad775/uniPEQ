import { describe, expect, it } from 'vitest';
import { nudge, roundField } from './nudge';

describe('nudge', () => {
	it('steps frequency by fractions of an octave', () => {
		expect(nudge({ min: 20, max: 20000 }, 'freq', 1000, 1)).toBe(1029);
		expect(nudge({ min: 20, max: 20000 }, 'freq', 1000, 1, true)).toBe(1260);
		expect(nudge({ min: 20, max: 20000 }, 'freq', 1000, -1)).toBe(972);
	});

	it('steps gain by 0.1 dB or the grid, and 1 dB coarse', () => {
		expect(nudge({ min: -12, max: 12 }, 'gain', 3, 1)).toBe(3.1);
		expect(nudge({ min: -12, max: 12, step: 0.5 }, 'gain', 3, -1)).toBe(2.5);
		expect(nudge({ min: -12, max: 12 }, 'gain', 3, 1, true)).toBe(4);
	});

	it('stays inside the domain', () => {
		expect(nudge({ min: -12, max: 12 }, 'gain', 12, 1)).toBe(12);
		expect(nudge({ min: 20, max: 20000 }, 'freq', 20, -1)).toBe(20);
	});

	it('moves along a value list, one value at a time', () => {
		const d = { values: [31, 62, 125, 250, 500] };
		expect(nudge(d, 'freq', 125, 1)).toBe(250);
		expect(nudge(d, 'freq', 125, -1)).toBe(62);
		expect(nudge(d, 'freq', 100, 1)).toBe(125);
		expect(nudge(d, 'freq', 500, 1)).toBe(500);
		expect(nudge(d, 'freq', 31, 1, true)).toBe(250);
	});

	it('takes a full grid step when a fine step would round back to where it was', () => {
		expect(nudge({ min: 20, max: 20000, step: 100 }, 'freq', 1000, 1)).toBe(1100);
	});

	it('keeps a locked value', () => {
		expect(nudge({ value: 1.41 }, 'q', 1.41, 1)).toBe(1.41);
	});
});

describe('roundField', () => {
	it('rounds to what an edit should produce', () => {
		expect(roundField('freq', 1234.56)).toBe(1235);
		expect(roundField('freq', 44.44)).toBe(44.4);
		expect(roundField('gain', -0.04)).toBe(0);
		expect(roundField('q', 0.001)).toBe(0.01);
	});
});
