/**
 * Keyboard steps for a band's fields, shared by the graph's nodes and the band editor: musical for
 * frequency and Q (fractions of an octave, so a step means the same at 50 Hz and 5 kHz), linear for
 * gain, and always onto the slot's domain.
 */
import { near, project, type Domain } from '@potatosalad775/eqcaps-core';

export type BandField = 'freq' | 'q' | 'gain';

/** Decimals edits keep: whole Hz (0.1 Hz below 100), 0.1 dB, Q to 0.01. */
function decimals(field: BandField, v: number): number {
	if (field === 'freq') return v < 100 ? 1 : 0;
	return field === 'gain' ? 1 : 2;
}

function round(v: number, d: number): number {
	return Math.round(v * 10 ** d) / 10 ** d || 0;
}

/** The finest step an edit takes: a device grid finer than this isn't worth showing. */
export const EDIT_STEP: Record<BandField, number> = { freq: 0.1, gain: 0.1, q: 0.01 };

/** Values as edits produce them: whole Hz (0.1 Hz below 100), 0.1 dB, Q to 0.01. */
export function roundField(field: BandField, v: number): number {
	const r = round(v, decimals(field, v));
	return field === 'q' ? Math.max(0.01, r) : r;
}

/**
 * A value as screens show it: at edit precision, or one decimal finer when that is exact (a
 * 0.25 dB grid, Q 0.707). A device's binary grid (1/256 dB) lands next to what was asked, and
 * 0.1015625 would only be noise: the difference can't be heard.
 */
export function shownField(field: BandField, v: number): number {
	const d = decimals(field, v);
	const fine = round(v, d + 1);
	return Math.abs(fine - v) < 1e-9 ? fine : round(v, d);
}

/**
 * `current` moved one step up (`dir` 1) or down (-1) within `d`; `coarse` (Shift) takes a bigger
 * one. Fine / coarse: frequency 1/24 / 1/3 octave, Q 1/12 / 1/2 octave, gain 0.1 (or the grid
 * step) / 1 dB. A value list moves one listed value (three when coarse).
 */
export function nudge(
	d: Domain,
	field: BandField,
	current: number,
	dir: 1 | -1,
	coarse = false
): number {
	if ('value' in d) return d.value;
	if ('values' in d) {
		const values = d.values;
		const eps = 1e-9 * Math.max(1, Math.abs(current));
		const n = coarse ? 3 : 1;
		let i: number;
		if (dir > 0) {
			i = values.findIndex((v) => v > current + eps);
			i = i < 0 ? values.length - 1 : i + n - 1;
		} else {
			i = values.findLastIndex((v) => v < current - eps);
			i = i < 0 ? 0 : i - n + 1;
		}
		return values[Math.min(values.length - 1, Math.max(0, i))];
	}
	const grid = 'step' in d ? d.step : 0;
	let v: number;
	if (field === 'gain') v = current + dir * (coarse ? Math.max(1, grid) : Math.max(0.1, grid));
	else if (field === 'freq') v = current * 2 ** (dir * (coarse ? 1 / 3 : 1 / 24));
	else v = current * 2 ** (dir * (coarse ? 1 / 2 : 1 / 12));
	const next = project(roundField(field, v), d, field);
	// A coarse grid can round a small step back onto where it started: take one grid step instead.
	if (grid > 0 && near(next, current)) return project(current + dir * grid, d, field);
	return next;
}
