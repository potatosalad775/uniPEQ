/**
 * The app's EQ model (rebuild decision 5): eqcaps filter type codes and units, plus `enabled`,
 * which is app-only (a disabled band is still on screen and still written, flat).
 */
import type { Filter, KnownFilterType } from '@potatosalad775/eqcaps-core';

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
	/** dB. Ignored when the device's preamp mode is `auto` or `none`. */
	pregain: number;
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
