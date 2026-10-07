// Adapted from modernGraphTool src/lib/utils/eq-preamp.spec.ts @ 23ddc4dd.
import { describe, expect, it } from 'vitest';
import { combinedResponseDb, logFreqGrid } from './biquad';
import { derivePreamp } from './eq-preamp';
import type { EqFilter } from './model';

function makeFilter(overrides: Partial<EqFilter> = {}): EqFilter {
	return { type: 'PK', freq: 1000, q: 1.0, gain: 0, ...overrides };
}

describe('derivePreamp', () => {
	it('is zero for an empty list', () => {
		expect(derivePreamp([])).toBe(0);
	});

	it('is minus the largest boost', () => {
		expect(derivePreamp([makeFilter({ gain: 6 })])).toBe(-6);
	});

	it('gives no make-up gain to a cut-only EQ', () => {
		expect(derivePreamp([makeFilter({ gain: -6 })])).toBe(0);
	});

	// 2070 Hz sits halfway between two points of a 100-point grid, which read this +6 dB, Q 6 peak
	// as about +5.1 dB and let it clip.
	it('covers the full peak of a narrow boost that falls between grid points', () => {
		expect(derivePreamp([makeFilter({ freq: 2070, q: 6, gain: 6 })])).toBe(-6);
	});

	it('counts the resonance of a high-Q high-pass', () => {
		expect(derivePreamp([makeFilter({ type: 'HPQ', freq: 100, q: 4 })])).toBeLessThan(-10);
	});

	it('rounds towards more headroom, to 0.1 dB', () => {
		const two = [makeFilter({ gain: 3 }), makeFilter({ freq: 1100, gain: 3 })];
		const peak = Math.max(...combinedResponseDb(two, logFreqGrid(4000, 900, 1300)));
		const headroom = -derivePreamp(two);
		expect(headroom).toBeGreaterThanOrEqual(peak);
		expect(headroom).toBeLessThan(peak + 0.1);
		expect(Math.round(headroom * 10)).toBeCloseTo(headroom * 10, 9);
	});
});
