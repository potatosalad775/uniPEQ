/**
 * The app's EQ model (rebuild decision 5): eqcaps filter type codes and units, plus `enabled`,
 * which is app-only (a disabled band is still on screen and still written, flat).
 */
import { isKnownType, type Filter, type KnownFilterType } from '@potatosalad775/eqcaps-core';

/** The eqcaps v1 filter types: `PK LSC HSC LPQ HPQ BP NO AP`. */
export type FilterType = KnownFilterType;

/** One band: Hz, RBJ-cookbook Q, dB, as eqcaps defines them. */
export interface EqFilter extends Filter {
	type: FilterType;
	enabled: boolean;
}

/** The editable EQ: what the graph shows and a push writes. */
export interface EqState {
	filters: EqFilter[];
	/** dB. Ignored when the device's preamp mode is `auto` or `none`. (A preset's `pregain`.) */
	preamp: number;
}

/**
 * A saved preset. schemaVersion 2 uses the eqcaps type codes; validating imports and migrating
 * schemaVersion 1 presets (`LSQ` → `LSC`, …) is Phase 3 (docs/rebuild-plan.md).
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
	pregain: number | 'auto';
	filters: EqFilter[];
}

/** A band read from a device, enabled; null for a type the app can't edit (an `x-` type). */
export function fromCapsFilter(filter: Filter): EqFilter | null {
	if (!isKnownType(filter.type)) return null;
	return { type: filter.type, freq: filter.freq, q: filter.q, gain: filter.gain, enabled: true };
}

export function eqFiltersEqual(a: EqFilter, b: EqFilter): boolean {
	return (
		a.type === b.type &&
		a.freq === b.freq &&
		a.q === b.q &&
		a.gain === b.gain &&
		a.enabled === b.enabled
	);
}
