/**
 * Which preamp control the EQ screen shows, from the profile's `preamp.mode` (eqcaps SPEC §9) and
 * whether the protocol can write a preamp at all.
 */
import { domainBounds, type Domain, type Profile } from '@potatosalad775/eqcaps-core';

/** The slider's range where the profile gives none (`unknown`): cut only, as `derivePreamp` is. */
const UNKNOWN_RANGE: Domain = { min: -20, max: 0, step: 0.1 };

export type PreampControl =
	/**
	 * A slider over `domain`. `unknown`: the profile doesn't say what the device takes, so the range
	 * is a guess and a write may be adjusted.
	 */
	| { kind: 'slider'; domain: Domain; min: number; max: number; step: number; unknown: boolean }
	/** The device sets its own headroom: nothing to show. */
	| { kind: 'auto' }
	/** No preamp reaches the device: a boost may clip, so warn about one. */
	| { kind: 'none' };

/**
 * `writesPreamp`: whether the connected protocol can send a preamp; null with no device, where the
 * preamp is only part of the preset.
 */
export function preampControl(profile: Profile, writesPreamp: boolean | null): PreampControl {
	const preamp = profile.preamp;
	if (preamp.mode === 'auto') return { kind: 'auto' };
	if (preamp.mode === 'none' || writesPreamp === false) return { kind: 'none' };
	const domain = preamp.mode === 'manual' ? preamp.gain : UNKNOWN_RANGE;
	const { min, max } = domainBounds(domain);
	const step = 'step' in domain ? domain.step : 0.1;
	return { kind: 'slider', domain, min, max, step, unknown: preamp.mode === 'unknown' };
}
