import { describe, expect, it } from 'vitest';
import { graphicProfile, hardwareProfile, softwareProfile } from './__fixtures__/profiles';
import {
	dbAt,
	dbRange,
	freqAt,
	gridDbs,
	nodeDb,
	PAD,
	pinchQ,
	wheelQ,
	xOf,
	yOf,
	type Plot
} from './graph-scale';

const plot: Plot = { width: 538, height: 228, db: 12 };

describe('graph scales', () => {
	it('maps frequency logarithmically, and back', () => {
		expect(xOf(20, plot)).toBe(PAD.left);
		expect(xOf(20000, plot)).toBe(plot.width - PAD.right);
		// 632 Hz is the log midpoint of 20 Hz – 20 kHz.
		expect(xOf(632.46, plot)).toBeCloseTo(PAD.left + 250, 0);
		expect(freqAt(xOf(1234, plot), plot)).toBeCloseTo(1234, 6);
	});

	it('maps dB linearly with 0 dB in the middle, and back', () => {
		expect(yOf(12, plot)).toBe(PAD.top);
		expect(yOf(-12, plot)).toBe(plot.height - PAD.bottom);
		expect(yOf(0, plot)).toBe(PAD.top + 100);
		expect(dbAt(yOf(-4.5, plot), plot)).toBeCloseTo(-4.5, 9);
	});

	it('clamps outside the plot', () => {
		expect(freqAt(-50, plot)).toBe(20);
		expect(dbAt(10_000, plot)).toBe(-12);
		expect(yOf(40, plot)).toBe(PAD.top);
	});
});

describe('dbRange', () => {
	const band = (gain: number) => ({ type: 'PK' as const, freq: 1000, q: 1, gain, enabled: true });

	it('is at least ±12 dB', () => {
		expect(dbRange(softwareProfile('s'), [], [])).toBe(12);
	});

	it("covers the device's gain range", () => {
		const p = hardwareProfile('h', {
			bandCount: 2,
			band: {
				types: ['PK'],
				freq: { min: 20, max: 20000 },
				q: { min: 0.1, max: 10 },
				gain: { min: -20, max: 15 }
			}
		});
		expect(dbRange(p, [], [])).toBe(24);
	});

	it('widens to the bands and boosts, not to a dip', () => {
		expect(dbRange(softwareProfile('s'), [band(-17)], [])).toBe(18);
		expect(dbRange(softwareProfile('s'), [], [13])).toBe(18);
		expect(dbRange(softwareProfile('s'), [], [-90])).toBe(12);
	});

	it('works for a graphic EQ', () => {
		const p = graphicProfile('g', [{ freq: 100, q: 1 }], { min: -6, max: 6 });
		expect(dbRange(p, [], [])).toBe(12);
	});
});

describe('graph helpers', () => {
	it('draws 3 dB gridlines up to ±12, 6 dB above', () => {
		expect(gridDbs(12)).toEqual([-12, -9, -6, -3, 0, 3, 6, 9, 12]);
		expect(gridDbs(18)).toEqual([-18, -12, -6, 0, 6, 12, 18]);
	});

	it('puts a gainless band on the 0 dB line', () => {
		expect(nodeDb({ type: 'HPQ', freq: 80, q: 0.7, gain: 5, enabled: true })).toBe(0);
		expect(nodeDb({ type: 'PK', freq: 80, q: 0.7, gain: 5, enabled: true })).toBe(5);
	});

	it('lowers Q as fingers spread, and as the wheel turns down', () => {
		expect(pinchQ(2, 100, 200)).toBe(1);
		expect(pinchQ(2, 100, 50)).toBe(4);
		expect(wheelQ(1, 100)).toBeCloseTo(1 / 1.1, 9);
		expect(wheelQ(1, -100)).toBeCloseTo(1.1, 9);
	});
});
