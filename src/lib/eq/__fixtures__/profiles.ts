// Adapted from modernGraphTool src/lib/utils/__fixtures__/eq-profiles.ts @ 23ddc4dd: plain
// profiles, without that app's constraint-picker wrapper.
/**
 * eqcaps profiles for specs.
 */
import type { Domain, FilterType, Profile } from '@potatosalad775/eqcaps-core';

/** A software profile whose every slot is the same: `maxBands` slots, unbounded at 0. */
export function softwareProfile(
	id: string,
	opts: { maxBands?: number; types?: FilterType[]; freq?: Domain; q?: Domain; gain?: Domain } = {}
): Profile {
	return {
		schemaVersion: '1.0',
		id,
		kind: 'software',
		device: { brand: 'Spec', model: id },
		bandCount: opts.maxBands ? opts.maxBands : null,
		band: {
			types: opts.types ?? ['PK', 'LSC', 'HSC'],
			freq: opts.freq ?? { min: 20, max: 20000 },
			q: opts.q ?? { min: 0.1, max: 10 },
			gain: opts.gain ?? { min: -12, max: 12 }
		},
		preamp: { mode: 'manual', gain: { min: -30, max: 30 } },
		meta: { status: 'maintainer-verified', sources: [] }
	};
}

/** A graphic EQ: one PK slot per band, frequency and Q locked. */
export function graphicProfile(
	id: string,
	bands: { freq: number; q: number }[],
	gain: Domain = { min: -10, max: 10 }
): Profile {
	return {
		schemaVersion: '1.0',
		id,
		kind: 'software',
		device: { brand: 'Spec', model: id },
		bandCount: bands.length,
		band: {
			types: ['PK'],
			freq: { value: bands[0]?.freq ?? 1000 },
			q: { value: bands[0]?.q ?? 1 },
			gain
		},
		bands: bands.map((b, index) => ({ index, freq: { value: b.freq }, q: { value: b.q } })),
		preamp: { mode: 'manual', gain: { min: -30, max: 30 } },
		meta: { status: 'maintainer-verified', sources: [] }
	};
}

/** A hardware profile: `bandCount` slots, with optional per-slot overrides. */
export function hardwareProfile(
	id: string,
	opts: {
		bandCount: number;
		band?: Profile['band'];
		bands?: Profile['bands'];
		preamp?: Profile['preamp'];
		status?: Profile['meta']['status'];
	}
): Profile {
	return {
		schemaVersion: '1.0',
		id,
		kind: 'hardware',
		device: { brand: 'Spec', model: id },
		bandCount: opts.bandCount,
		band: opts.band ?? {
			types: ['PK', 'LSC', 'HSC'],
			freq: { min: 20, max: 20000, step: 1 },
			q: { min: 0.1, max: 10, step: 0.01 },
			gain: { min: -12, max: 12, step: 0.1 }
		},
		...(opts.bands ? { bands: opts.bands } : {}),
		preamp: opts.preamp ?? { mode: 'manual', gain: { min: -12, max: 0, step: 0.5 } },
		meta: { status: opts.status ?? 'community-verified', sources: [] }
	};
}
