// Adapted from modernGraphTool src/lib/utils/eq-constraint.ts @ 23ddc4dd: the app model already
// speaks eqcaps type codes, bands have no channel and no unset fields, and the
// software-profile builders and AutoEQ envelope helpers are left out.
import {
	assign,
	domainBounds,
	isGraphic,
	isKnownType,
	isLockedDomain,
	project,
	resolveSlot,
	usesGain,
	validateList,
	type Domain,
	type EffectiveSlot,
	type Filter,
	type FilterType as CapsFilterType,
	type Profile
} from '@potatosalad775/eqcaps-core';
import { eqFiltersEqual, type EqFilter, type FilterType } from './model';

/**
 * Pure helpers between the app's `EqFilter` list and an eqcaps `Profile`.
 *
 * The engine (`fit`, `validateList`, `resolveSlot`, `project`) is eqcaps core's; this module only
 * bridges the list and the profile. The store is the source of truth; everything here is
 * stateless.
 */

// ─── Filters ────────────────────────────────────────────────────────────────

/** A band as a plain eqcaps filter (a copy, so nothing downstream holds the store's object). */
export function toCapsFilter(f: EqFilter): Filter {
	return { type: f.type, freq: f.freq, q: f.q, gain: f.gain };
}

/** The app types a slot accepts, in the slot's preference order (`x-` types left out). */
export function appTypesOf(types: readonly CapsFilterType[]): FilterType[] {
	return types.filter(isKnownType);
}

// ─── The profile with no device ─────────────────────────────────────────────

/**
 * What the editor checks against while no device is connected: every app type, and ranges wide
 * enough for any preset file, so nothing is flagged. A device's profile replaces it on connect.
 */
export const UNCONSTRAINED: Profile = {
	schemaVersion: '1.0',
	id: 'unipeq-unconstrained',
	kind: 'software',
	device: { brand: 'uniPEQ', model: 'Unconstrained' },
	bandCount: null,
	band: {
		types: ['PK', 'LSC', 'HSC', 'LPQ', 'HPQ', 'BP', 'NO', 'AP'],
		freq: { min: 10, max: 24000 },
		q: { min: 0.05, max: 30 },
		gain: { min: -30, max: 30 }
	},
	preamp: { mode: 'manual', gain: { min: -30, max: 10 } },
	meta: { status: 'maintainer-verified', sources: [] }
};

// ─── Reading profiles ───────────────────────────────────────────────────────

/** Band cap; 0 = unlimited. */
export function maxBandsOf(profile: Profile): number {
	return profile.bandCount ?? 0;
}

/**
 * A fixed-band graphic EQ: a bounded profile whose every slot has a locked frequency. The UI then
 * shows one row per band and only gain moves.
 */
export function isGraphicProfile(profile: Profile): boolean {
	return profile.bandCount !== null && isGraphic(profile);
}

/** Domains of slot `slot`, or the template when the profile has no such slot. */
export function slotOf(profile: Profile, slot: number, filter?: EqFilter): EffectiveSlot {
	const i = profile.bandCount === null ? Math.max(0, slot) : clampSlot(profile, slot);
	return filter ? resolveSlot(profile, i, toCapsFilter(filter)) : resolveSlot(profile, i);
}

function clampSlot(profile: Profile, slot: number): number {
	const n = profile.bandCount ?? 1;
	return Math.min(Math.max(0, slot), Math.max(0, n - 1));
}

/** Locked value of a domain, or its value nearest `fallback`. */
function pinned(d: Domain, field: 'freq' | 'q' | 'gain', fallback: number): number {
	return isLockedDomain(d) ? domainBounds(d).min : project(fallback, d, field);
}

/** The bands of a graphic profile, in slot order. Empty for anything else. */
export function graphicBandsOf(profile: Profile): { freq: number; q: number }[] {
	if (!isGraphicProfile(profile)) return [];
	const out: { freq: number; q: number }[] = [];
	for (let i = 0; i < (profile.bandCount ?? 0); i++) {
		const s = resolveSlot(profile, i);
		out.push({ freq: pinned(s.freq, 'freq', 1000), q: pinned(s.q, 'q', 1.41) });
	}
	return out;
}

// ─── Slot analysis ──────────────────────────────────────────────────────────

/**
 * The slot each band sits in: the one eqcaps' `assign` gives it (a band that needs a low-shelf slot
 * finds it), else its position in the list, which is what any slot of a uniform profile would be.
 */
export function assignSlots(filters: EqFilter[], profile: Profile): number[] {
	if (profile.bandCount === null) return filters.map(() => 0);
	const assigned = filters.length ? assign(profile, filters.map(toCapsFilter)).slotOf : [];
	return filters.map((_, position) => clampSlot(profile, assigned[position] ?? position));
}

/** What's wrong with a band, per field. All `false` means it's valid. */
export interface FilterViolation {
	type: boolean;
	freq: boolean;
	q: boolean;
	gain: boolean;
}

const PASS: FilterViolation = { type: false, freq: false, q: false, gain: false };

/**
 * Per-band field flags from eqcaps' `validateList`. A band past the cap isn't flagged:
 * `isPastMaxBands` greys it instead. A broken cross-band rule (ascending frequency, minimum
 * spacing) is a frequency problem.
 */
export function filterViolations(filters: EqFilter[], profile: Profile): FilterViolation[] {
	const out: FilterViolation[] = filters.map(() => ({ ...PASS }));
	if (!filters.length) return out;
	for (const v of validateList(profile, filters.map(toCapsFilter))) {
		if (v.filter === undefined || v.code === 'too-many-bands') continue;
		const flags = out[v.filter];
		if (v.field === 'type') flags.type = true;
		else if (v.field === 'q') flags.q = true;
		else if (v.field === 'gain') flags.gain = true;
		else flags.freq = true;
	}
	return out;
}

/** Whether any band breaks the profile. */
export function hasViolations(violations: FilterViolation[]): boolean {
	return violations.some((v) => v.type || v.freq || v.q || v.gain);
}

/** Whether the band at `index` is past the profile's band cap. */
export function isPastMaxBands(index: number, profile: Profile): boolean {
	const max = maxBandsOf(profile);
	return max > 0 && index >= max;
}

// ─── Projection ─────────────────────────────────────────────────────────────

/**
 * Move one band onto slot `slot`'s domains (eqcaps `project`): the type to the slot's first type
 * the app can hold if its own isn't allowed, then frequency, Q and gain, each resolved against the
 * fields already settled so conditional domains apply. The input is not mutated.
 */
export function projectFilter(filter: EqFilter, profile: Profile, slot: number): EqFilter {
	const out: EqFilter = { ...filter };
	const types = slotOf(profile, slot).types;
	if (!types.includes(out.type)) {
		const allowed = appTypesOf(types);
		if (allowed.length) out.type = allowed[0];
	}
	for (const field of ['freq', 'q', 'gain'] as const) {
		out[field] = project(out[field], slotOf(profile, slot, out)[field], field);
	}
	return out;
}

/**
 * Band `filter` with `patch` applied, each patched number projected onto slot `slot`'s domain (as
 * resolved for the patched band, so conditional domains apply). Fields the patch leaves alone stay
 * as they are, out of range or not: an edit never fixes other fields behind the user's back (that's
 * Fit's job). A type the slot doesn't take is kept too; the UI offers only the slot's types.
 */
export function editFilter(
	filter: EqFilter,
	patch: Partial<EqFilter>,
	profile: Profile,
	slot: number
): EqFilter {
	const out: EqFilter = { ...filter, ...patch };
	for (const field of ['freq', 'q', 'gain'] as const) {
		if (patch[field] === undefined) continue;
		out[field] = project(patch[field], slotOf(profile, slot, out)[field], field);
	}
	return out;
}

/**
 * A band to add to `filters`: flat, in the widest log-frequency gap of the slot's range (ends
 * included), at the nearest one-third-octave nominal frequency, projected onto the slot it will
 * take. A peak when the slot takes one, else the slot's first type.
 */
export function newBand(filters: EqFilter[], profile: Profile): EqFilter {
	const slot = profile.bandCount === null ? 0 : clampSlot(profile, filters.length);
	const { min, max } = domainBounds(slotOf(profile, slot).freq);
	const lo = Math.max(min, 20);
	const hi = Math.min(max, 20000);
	const taken = filters.flatMap((f) => (f.freq > lo && f.freq < hi ? [f.freq] : []));
	const edges = [...new Set([lo, ...taken, hi])].sort((a, b) => a - b);
	let widest = 0;
	for (let g = 1; g < edges.length - 1; g++) {
		if (edges[g + 1] / edges[g] > edges[widest + 1] / edges[widest]) widest = g;
	}
	const [freq] = spreadNominal(edges[widest], edges[widest + 1], 1);
	const types = appTypesOf(slotOf(profile, slot).types);
	const type = types.includes('PK') ? 'PK' : (types[0] ?? 'PK');
	return projectFilter({ type, freq, q: 1, gain: 0 }, profile, slot);
}

/**
 * `filter` made flat where it sits (a device's bands are reset, not removed): a 0 dB
 * peak at Q 1 on the same frequency, as Fit's padding bands are, or the slot's first type where it
 * takes no peak. Projected onto the slot.
 */
export function flatBand(filter: EqFilter, profile: Profile, slot: number): EqFilter {
	const types = appTypesOf(slotOf(profile, slot).types);
	const type = types.includes('PK') ? 'PK' : (types[0] ?? filter.type);
	return projectFilter({ type, freq: filter.freq, q: 1, gain: 0 }, profile, slot);
}

/** Whether two lists hold the same bands, in order. */
export function sameFilters(a: EqFilter[], b: EqFilter[]): boolean {
	return a.length === b.length && a.every((f, i) => eqFiltersEqual(f, b[i]));
}

/**
 * What Fit makes of the list: folded onto the profile (`conformFilters`), and for a hardware
 * device filled up to its band count with flat bands, so it holds what the device will after a
 * push. Fit is always the user's call (device-peq invariant 3).
 */
export function fitFilters(filters: EqFilter[], profile: Profile): EqFilter[] {
	return padToBandCount(conformFilters(filters, profile), profile);
}

/**
 * Fold a whole list onto the profile: trim it to the band cap (the tail goes first), then project
 * every band onto the slot it sits in. Graphic profiles are a special case: the result is always
 * one row per band, in band order, each taking the gain of the nearest source band within an
 * octave. That keeps the 1:1 row-to-band mapping the UI relies on.
 */
export function conformFilters(filters: EqFilter[], profile: Profile): EqFilter[] {
	if (isGraphicProfile(profile)) return foldOntoGraphicBands(filters, profile);
	const max = maxBandsOf(profile);
	const kept = max > 0 ? filters.slice(0, max) : filters;
	const slots = assignSlots(kept, profile);
	return kept.map((f, i) => projectFilter(f, profile, slots[i]));
}

/**
 * Fill a hardware device's list up to its band count with flat bands, so the list holds one row
 * per band the device has and a push reads back as it was written. Each new band is a 0 dB PK at
 * Q 1. The new bands are shared out among the gaps between the bands already there (or the
 * frequency range's ends), widest gap first, spread evenly in log frequency within each, and moved
 * to the nearest one-third-octave nominal frequency, so they read 40, 100, 200 Hz rather than
 * 47, 112, 173. They are appended in ascending order and projected onto their slots, so existing
 * rows keep their place. Software profiles and graphic EQs come back unchanged: a software cap is
 * a limit, not a layout, and a graphic fold already has one row per band.
 */
export function padToBandCount(filters: EqFilter[], profile: Profile): EqFilter[] {
	if (profile.kind !== 'hardware' || profile.bandCount === null || isGraphicProfile(profile)) {
		return filters;
	}
	const missing = profile.bandCount - filters.length;
	if (missing <= 0) return filters;
	const { min, max } = domainBounds(slotOf(profile, 0).freq);
	const taken = filters.flatMap((f) => (f.freq > min && f.freq < max ? [f.freq] : []));
	const edges = [...new Set([min, ...taken, max])].sort((a, b) => a - b);
	const counts = edges.slice(1).map(() => 0);
	const width = (g: number) => Math.log(edges[g + 1] / edges[g]);
	for (let n = 0; n < missing; n++) {
		let widest = 0;
		for (let g = 1; g < counts.length; g++) {
			if (width(g) / (counts[g] + 1) > width(widest) / (counts[widest] + 1)) widest = g;
		}
		counts[widest]++;
	}
	const added: EqFilter[] = counts.flatMap((count, g) =>
		spreadNominal(edges[g], edges[g + 1], count).map((freq) => ({
			type: 'PK' as const,
			freq,
			q: 1,
			gain: 0
		}))
	);
	const slots = assignSlots([...filters, ...added], profile);
	const flat = added
		.map((f, k) => projectFilter(f, profile, slots[filters.length + k]))
		.filter((f) => f.gain === 0);
	return [...filters, ...flat];
}

/** ISO 266 one-third-octave nominal frequencies, 10 Hz – 20 kHz. */
const NOMINAL_FREQS = [
	10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
	1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
];

/**
 * `count` frequencies strictly between `lo` and `hi`, ascending: evenly spaced in log frequency,
 * each moved to the nearest nominal frequency within a third of an octave that keeps the order.
 * Ties go to the lower one, as in eqcaps' own fillers.
 */
function spreadNominal(lo: number, hi: number, count: number): number[] {
	const out: number[] = [];
	let prev = lo;
	for (let k = 1; k <= count; k++) {
		const target = lo * (hi / lo) ** (k / (count + 1));
		const distance = (f: number) => Math.abs(Math.log(f / target));
		let best: number | null = null;
		for (const f of NOMINAL_FREQS) {
			if (f <= prev || f >= hi || distance(f) > Math.LN2 / 3) continue;
			if (best === null || distance(f) < distance(best) - 1e-9) best = f;
		}
		prev = best ?? (target > prev ? target : Math.sqrt(prev * hi));
		out.push(prev);
	}
	return out;
}

const GRAPHIC_FOLD_LOG_THRESHOLD = Math.log(2); // ±1 octave

function foldOntoGraphicBands(filters: EqFilter[], profile: Profile): EqFilter[] {
	const bands = graphicBandsOf(profile);
	const sources = filters.filter((f) => usesGain(f.type));
	return bands.map((band, slot): EqFilter => {
		let bestGain = 0;
		let bestDelta = Infinity;
		for (const f of sources) {
			const delta = Math.abs(Math.log(f.freq / band.freq));
			if (delta < bestDelta && delta < GRAPHIC_FOLD_LOG_THRESHOLD) {
				bestDelta = delta;
				bestGain = f.gain;
			}
		}
		return projectFilter({ type: 'PK', freq: band.freq, q: band.q, gain: bestGain }, profile, slot);
	});
}
