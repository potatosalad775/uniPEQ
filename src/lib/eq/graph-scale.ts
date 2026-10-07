/**
 * Scales for the EQ graph: log frequency across, linear dB up. Pure, so the gestures can be tested
 * without a DOM.
 */
import { domainBounds, resolveSlot, usesGain, type Profile } from '@potatosalad775/eqcaps-core';
import type { EqFilter } from './model';

export const F_MIN = 20;
export const F_MAX = 20000;
const LOG_SPAN = Math.log(F_MAX / F_MIN);

/** Gridlines across: the decades and their 2 and 5 multiples. */
export const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Room around the plot for the axis labels, px. */
export const PAD = { top: 8, right: 8, bottom: 20, left: 30 };

export interface Plot {
	width: number;
	height: number;
	/** Symmetric dB range: ±`db`. */
	db: number;
}

const innerW = (p: Plot) => Math.max(1, p.width - PAD.left - PAD.right);
const innerH = (p: Plot) => Math.max(1, p.height - PAD.top - PAD.bottom);

export function xOf(freq: number, p: Plot): number {
	const f = Math.min(F_MAX, Math.max(F_MIN, freq));
	return PAD.left + (Math.log(f / F_MIN) / LOG_SPAN) * innerW(p);
}

export function freqAt(x: number, p: Plot): number {
	const t = Math.min(1, Math.max(0, (x - PAD.left) / innerW(p)));
	return F_MIN * Math.exp(t * LOG_SPAN);
}

export function yOf(db: number, p: Plot): number {
	const d = Math.min(p.db, Math.max(-p.db, db));
	return PAD.top + ((p.db - d) / (2 * p.db)) * innerH(p);
}

export function dbAt(y: number, p: Plot): number {
	const t = Math.min(1, Math.max(0, (y - PAD.top) / innerH(p)));
	return p.db - t * 2 * p.db;
}

/**
 * The dB range to show: the profile's widest gain range (at least ±12 dB, so a ±3 dB device still
 * has room to see a curve), widened to whatever the band gains and the response's boosts reach, in
 * 6 dB steps. Not to the response's dips: a notch reads -100 dB at its centre, and the curve may
 * leave the plot there.
 */
export function dbRange(profile: Profile, filters: EqFilter[], response: number[]): number {
	let reach = 12;
	if (profile.bandCount !== null) {
		for (let i = 0; i < profile.bandCount; i++) {
			const { min, max } = domainBounds(resolveSlot(profile, i).gain);
			reach = Math.max(reach, Math.abs(min), Math.abs(max));
		}
	}
	for (const f of filters) if (usesGain(f.type)) reach = Math.max(reach, Math.abs(f.gain));
	for (const r of response) if (r > reach) reach = r;
	return Math.min(36, Math.ceil(reach / 6) * 6);
}

/** dB gridlines for a ±`db` range: every 3 dB up to ±12, every 6 above. */
export function gridDbs(db: number): number[] {
	const step = db <= 12 ? 3 : 6;
	const out: number[] = [];
	for (let d = -db; d <= db; d += step) out.push(d);
	return out;
}

/** "20", "500", "1k", "20k". */
export function freqLabel(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** The y a band's node sits at: its gain, or 0 dB for a type with none (a low-pass, a notch). */
export function nodeDb(f: EqFilter): number {
	return usesGain(f.type) ? f.gain : 0;
}

/** An SVG path through `points`. */
export function pathOf(xs: number[], ys: number[]): string {
	return xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join('');
}

/** Q after a pinch from `startDistance` to `distance`: fingers apart widen the band (lower Q). */
export function pinchQ(startQ: number, startDistance: number, distance: number): number {
	if (startDistance <= 0 || distance <= 0) return startQ;
	return startQ * (startDistance / distance);
}

/** Q after a wheel turn: each notch (100 px of delta) scales it by 10 %; up narrows. */
export function wheelQ(q: number, deltaY: number): number {
	return q * Math.pow(1.1, -deltaY / 100);
}
