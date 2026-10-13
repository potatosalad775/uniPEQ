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

/**
 * Auto preamp on this device: the derived value moved down onto one the device takes, so a coarse
 * grid never hands back headroom (-6.1 dB on a 1 dB grid is -7, not the nearest -6). Below the
 * device's range it is the lowest the device takes. Without a slider it is `value` unchanged.
 */
export function headroomPreamp(value: number, control: PreampControl): number {
	if (control.kind !== 'slider') return value;
	const d = control.domain;
	if ('value' in d) return d.value;
	if ('values' in d) return [...d.values].reverse().find((v) => v <= value + 1e-9) ?? d.values[0];
	const clamped = Math.min(Math.max(value, d.min), d.max);
	if (!('step' in d)) return clamped;
	// eqcaps anchors a stepped grid at 0; min lies on it.
	const down = Math.floor(clamped / d.step + 1e-9) * d.step;
	return Math.max(Math.round(down * 1e10) / 1e10, d.min);
}
