import { describe, expect, it } from 'vitest';
import {
	biquadCoeffs,
	biquadMagnitudeDb,
	combinedResponseDb,
	computeAutoPregain,
	logFreqGrid
} from './biquad';
import type { EqFilter } from './model';

describe('eq/biquad', () => {
	it('peaking filter has ~gain dB at center frequency and ~0 far away', () => {
		const c = biquadCoeffs('PK', 1000, 6, 1.4);
		expect(biquadMagnitudeDb(c, 1000)).toBeCloseTo(6, 1);
		expect(Math.abs(biquadMagnitudeDb(c, 20))).toBeLessThan(0.2);
		expect(Math.abs(biquadMagnitudeDb(c, 20000))).toBeLessThan(0.5);
	});

	it('low shelf boosts lows and leaves highs alone', () => {
		const c = biquadCoeffs('LSC', 200, 4, 0.7);
		expect(biquadMagnitudeDb(c, 20)).toBeCloseTo(4, 1);
		expect(Math.abs(biquadMagnitudeDb(c, 10000))).toBeLessThan(0.2);
	});

	it('high shelf boosts highs and leaves lows alone', () => {
		const c = biquadCoeffs('HSC', 8000, -3, 0.7);
		expect(biquadMagnitudeDb(c, 20000)).toBeCloseTo(-3, 0);
		expect(Math.abs(biquadMagnitudeDb(c, 50))).toBeLessThan(0.1);
	});

	it('low and high pass are -3 dB at Fc for Q 0.707 and pass the other end', () => {
		const lp = biquadCoeffs('LPQ', 1000, 0, Math.SQRT1_2);
		const hp = biquadCoeffs('HPQ', 1000, 0, Math.SQRT1_2);
		expect(biquadMagnitudeDb(lp, 1000)).toBeCloseTo(-3, 0);
		expect(biquadMagnitudeDb(hp, 1000)).toBeCloseTo(-3, 0);
		expect(Math.abs(biquadMagnitudeDb(lp, 20))).toBeLessThan(0.01);
		expect(Math.abs(biquadMagnitudeDb(hp, 20000))).toBeLessThan(0.1);
	});

	it('band pass peaks at 0 dB and notch cuts deep at Fc', () => {
		expect(biquadMagnitudeDb(biquadCoeffs('BP', 1000, 0, 2), 1000)).toBeCloseTo(0, 1);
		expect(biquadMagnitudeDb(biquadCoeffs('NO', 1000, 0, 2), 1000)).toBeLessThan(-40);
	});

	it('all-pass has flat magnitude', () => {
		const c = biquadCoeffs('AP', 1000, 0, 1);
		for (const f of [50, 500, 5000, 15000]) {
			expect(Math.abs(biquadMagnitudeDb(c, f))).toBeLessThan(0.01);
		}
	});

	it('combinedResponseDb sums filters', () => {
		const filters: EqFilter[] = [
			{ type: 'PK', freq: 1000, gain: 3, q: 1, enabled: true },
			{ type: 'PK', freq: 1000, gain: 2, q: 1, enabled: true },
			{ type: 'PK', freq: 1000, gain: 5, q: 1, enabled: false } // disabled → ignored
		];
		const grid = logFreqGrid(64);
		const at1k = combinedResponseDb(filters, grid)[
			grid.findIndex((f) => Math.abs(f - 1000) === Math.min(...grid.map((g) => Math.abs(g - 1000))))
		];
		expect(at1k).toBeCloseTo(5, 0);
	});

	it('computeAutoPregain compensates the positive peak', () => {
		const filters: EqFilter[] = [{ type: 'PK', freq: 1000, gain: 6, q: 1, enabled: true }];
		const pregain = computeAutoPregain(filters);
		expect(pregain).toBeLessThanOrEqual(-5.9);
		expect(pregain).toBeGreaterThanOrEqual(-6.5);
	});

	it('computeAutoPregain is 0 for cut-only EQ', () => {
		const filters: EqFilter[] = [{ type: 'PK', freq: 1000, gain: -6, q: 1, enabled: true }];
		expect(computeAutoPregain(filters)).toBe(0);
	});
});
