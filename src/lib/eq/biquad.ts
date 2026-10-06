/**
 * Biquad magnitude-response math for the EQ response curve and pregain/headroom calculation.
 * Pure functions, RBJ cookbook coefficients, over the eqcaps filter types.
 */
import type { EqFilter, FilterType } from './model';

export interface BiquadCoeffs {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

/** RBJ audio-EQ-cookbook coefficients, normalized so a0 = 1. */
export function biquadCoeffs(
	type: FilterType,
	freq: number,
	gain: number,
	q: number,
	sampleRate = 48000
): BiquadCoeffs {
	const A = Math.pow(10, gain / 40);
	const w0 = (2 * Math.PI * freq) / sampleRate;
	const cosW0 = Math.cos(w0);
	const sinW0 = Math.sin(w0);
	const alpha = sinW0 / (2 * Math.max(q, 1e-4));

	let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

	switch (type) {
		case 'PK':
			b0 = 1 + alpha * A;
			b1 = -2 * cosW0;
			b2 = 1 - alpha * A;
			a0 = 1 + alpha / A;
			a1 = -2 * cosW0;
			a2 = 1 - alpha / A;
			break;
		case 'LSC': {
			const s = 2 * Math.sqrt(A) * alpha;
			b0 = A * (A + 1 - (A - 1) * cosW0 + s);
			b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
			b2 = A * (A + 1 - (A - 1) * cosW0 - s);
			a0 = A + 1 + (A - 1) * cosW0 + s;
			a1 = -2 * (A - 1 + (A + 1) * cosW0);
			a2 = A + 1 + (A - 1) * cosW0 - s;
			break;
		}
		case 'HSC': {
			const s = 2 * Math.sqrt(A) * alpha;
			b0 = A * (A + 1 + (A - 1) * cosW0 + s);
			b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
			b2 = A * (A + 1 + (A - 1) * cosW0 - s);
			a0 = A + 1 - (A - 1) * cosW0 + s;
			a1 = 2 * (A - 1 - (A + 1) * cosW0);
			a2 = A + 1 - (A - 1) * cosW0 - s;
			break;
		}
		case 'LPQ':
			b0 = (1 - cosW0) / 2;
			b1 = 1 - cosW0;
			b2 = (1 - cosW0) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cosW0;
			a2 = 1 - alpha;
			break;
		case 'HPQ':
			b0 = (1 + cosW0) / 2;
			b1 = -(1 + cosW0);
			b2 = (1 + cosW0) / 2;
			a0 = 1 + alpha;
			a1 = -2 * cosW0;
			a2 = 1 - alpha;
			break;
		case 'BP':
			b0 = alpha;
			b1 = 0;
			b2 = -alpha;
			a0 = 1 + alpha;
			a1 = -2 * cosW0;
			a2 = 1 - alpha;
			break;
		case 'NO':
			b0 = 1;
			b1 = -2 * cosW0;
			b2 = 1;
			a0 = 1 + alpha;
			a1 = -2 * cosW0;
			a2 = 1 - alpha;
			break;
		case 'AP':
			b0 = 1 - alpha;
			b1 = -2 * cosW0;
			b2 = 1 + alpha;
			a0 = 1 + alpha;
			a1 = -2 * cosW0;
			a2 = 1 - alpha;
			break;
	}

	return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude in dB of one biquad at frequency f. */
export function biquadMagnitudeDb(c: BiquadCoeffs, freq: number, sampleRate = 48000): number {
	const w = (2 * Math.PI * freq) / sampleRate;
	const cos1 = Math.cos(w);
	const cos2 = Math.cos(2 * w);
	const num =
		c.b0 * c.b0 +
		c.b1 * c.b1 +
		c.b2 * c.b2 +
		2 * (c.b0 * c.b1 + c.b1 * c.b2) * cos1 +
		2 * c.b0 * c.b2 * cos2;
	const den = 1 + c.a1 * c.a1 + c.a2 * c.a2 + 2 * (c.a1 + c.a1 * c.a2) * cos1 + 2 * c.a2 * cos2;
	return 10 * Math.log10(Math.max(num, 1e-20) / Math.max(den, 1e-20));
}

/** Log-spaced frequency grid. */
export function logFreqGrid(points = 128, fMin = 20, fMax = 20000): number[] {
	const grid: number[] = [];
	const ratio = Math.log(fMax / fMin);
	for (let i = 0; i < points; i++) {
		grid.push(fMin * Math.exp((ratio * i) / (points - 1)));
	}
	return grid;
}

/** Combined response (dB) of enabled filters over a frequency grid. */
export function combinedResponseDb(
	filters: EqFilter[],
	freqs: number[],
	sampleRate = 48000
): number[] {
	const coeffs = filters
		.filter((f) => f.enabled)
		.map((f) => biquadCoeffs(f.type, f.freq, f.gain, f.q, sampleRate));
	return freqs.map((f) => coeffs.reduce((sum, c) => sum + biquadMagnitudeDb(c, f, sampleRate), 0));
}

/**
 * Recommended pregain (to be replaced by modernGraphTool's eq-preamp.ts in Phase 3, which also
 * samples each band's own centre): negative of the maximum combined positive response,
 * so the EQ never clips. 0 when the curve never rises above 0 dB.
 */
export function computeAutoPregain(filters: EqFilter[], sampleRate = 48000): number {
	const response = combinedResponseDb(filters, logFreqGrid(256), sampleRate);
	const peak = Math.max(0, ...response);
	return peak > 0 ? -Math.ceil(peak * 10) / 10 : 0;
}
