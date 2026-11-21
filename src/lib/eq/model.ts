/**
 * The app's EQ model: eqcaps filter type codes and units. There is no per-band
 * on/off: no device has one, so every band on screen is a band the device plays.
 */
import { isKnownType, type Filter, type KnownFilterType } from '@potatosalad775/eqcaps-core';

/** The eqcaps v1 filter types: `PK LSC HSC LPQ HPQ BP NO AP`. */
export type FilterType = KnownFilterType;

/** One band: Hz, RBJ-cookbook Q, dB, as eqcaps defines them. */
export interface EqFilter extends Filter {
	type: FilterType;
}

/** The editable EQ: what the graph shows and a push writes. */
export interface EqState {
	filters: EqFilter[];
	/** dB. Ignored when the device's preamp mode is `auto` or `none`. (A preset's `pregain`.) */
	preamp: number;
}

/**
 * An output channel. A device whose profile says `channels: "independent"` holds an EQ for each;
 * every other device holds one for both.
 */
export type Channel = 'left' | 'right';

/** One channel's EQ as edited: its bands, and its preamp, following them (Auto) or set. */
export interface ChannelEq {
	filters: EqFilter[];
	autoPreamp: boolean;
	/** dB, as read or set by hand; ignored while `autoPreamp`. */
	manualPreamp: number;
}

/**
 * An EQ as a device holds it: one list for both channels, or with `right`, the left channel's
 * here and the right one's apart.
 */
export interface StereoEq extends EqState {
	right?: EqState;
}

/**
 * A whole EQ brought in at once (a read, a preset): one list for both channels, or with `right`,
 * the left channel's here and the right one's apart. A preamp is a fixed dB value, `'auto'` to
 * follow the bands, or left out to keep the one there; the right channel's left out is the left's.
 */
export interface EqLoad {
	filters: EqFilter[];
	preamp?: number | 'auto';
	right?: { filters: EqFilter[]; preamp?: number | 'auto' };
}

/**
 * A saved preset. schemaVersion 2 uses the eqcaps type codes; `preset-file.ts` checks stored and
 * imported ones and migrates the prototype's schemaVersion 1 (`LSQ` → `LSC`, …).
 */
export interface PeqPreset {
	schemaVersion: 2;
	id: string;
	name: string;
	description?: string;
	tags: string[];
	/** ISO 8601. */
	createdAt: string;
	updatedAt: string;
	source?: { deviceId?: string; app: 'uniPEQ'; appVersion: string };
	/** The left channel's, or both channels' when there is no `right`. */
	pregain: number | 'auto';
	filters: EqFilter[];
	/**
	 * The right channel, saved from an EQ set apart. Optional rather than a schema bump: a version
	 * that doesn't know it still loads the preset, as its left channel.
	 */
	right?: { pregain: number | 'auto'; filters: EqFilter[] };
}

/** A band read from a device; null for a type the app can't edit (an `x-` type). */
export function fromCapsFilter(filter: Filter): EqFilter | null {
	if (!isKnownType(filter.type)) return null;
	return { type: filter.type, freq: filter.freq, q: filter.q, gain: filter.gain };
}

export function eqFiltersEqual(a: EqFilter, b: EqFilter): boolean {
	return a.type === b.type && a.freq === b.freq && a.q === b.q && a.gain === b.gain;
}
