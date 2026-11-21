/**
 * How well a saved preset fits the connected device, for the Presets list: the same `planPush` a
 * write would run, summed up. (The prototype's "perfect fit / minor changes / lossy fit" badge,
 * now from eqcaps' `fit` instead of its own adaptation engine.) A preset's right channel counts
 * where the device holds it apart; elsewhere the left one is what would load.
 */
import { derivePreamp } from '#lib/eq/eq-preamp.js';
import type { EqFilter, EqState, PeqPreset } from '#lib/eq/model.js';
import type { Profile } from '@potatosalad775/eqcaps-core';
import { planPush } from './push-plan';
import type { PeqCapabilities } from './types';

export type PresetFit =
	/** Written as it is. */
	| { kind: 'exact' }
	/** Every band gets a slot, but `changes` values move to fit. */
	| { kind: 'adjusted'; changes: number }
	/** `dropped` boosting or cutting bands find no slot, or a device rule can't be met. */
	| { kind: 'lossy'; dropped: number };

const channel = (filters: EqFilter[], pregain: number | 'auto'): EqState => ({
	filters,
	preamp: pregain === 'auto' ? derivePreamp(filters) : pregain
});

export function presetFit(
	preset: Pick<PeqPreset, 'filters' | 'pregain' | 'right'>,
	profile: Profile,
	capabilities: Pick<PeqCapabilities, 'writesPreamp' | 'perChannel'>
): PresetFit {
	const { right } = preset;
	const plan = planPush(
		{
			...channel(preset.filters, preset.pregain),
			...(right ? { right: channel(right.filters, right.pregain) } : {})
		},
		profile,
		capabilities
	);
	const dropped = plan.changes.filter((c) => c.kind === 'dropped').length;
	if (dropped > 0 || plan.infeasible) return { kind: 'lossy', dropped };
	if (plan.changes.length > 0) return { kind: 'adjusted', changes: plan.changes.length };
	return { kind: 'exact' };
}
