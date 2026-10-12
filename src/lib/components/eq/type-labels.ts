import type { FilterType } from '$lib/eq/model';
import { shownField } from '$lib/eq/nudge';
import * as m from '$lib/paraglide/messages';

/** Each eqcaps filter type by name ("Peak", "Low shelf", …). The codes themselves stay as badges. */
export const TYPE_LABEL: Record<FilterType, () => string> = {
	PK: m.eq_type_pk,
	LSC: m.eq_type_lsc,
	HSC: m.eq_type_hsc,
	LPQ: m.eq_type_lpq,
	HPQ: m.eq_type_hpq,
	BP: m.eq_type_bp,
	NO: m.eq_type_no,
	AP: m.eq_type_ap
};

/**
 * "1234", "20000", "84.5": every digit, never rounded to kHz, and no grouping, so it reads as the
 * number box does. Graph ticks use `freqLabel` instead.
 */
export function formatFreq(f: number): string {
	return String(shownField('freq', f));
}

/** "1234 Hz". */
export function formatHz(f: number): string {
	return `${formatFreq(f)} Hz`;
}

/** "+3.5", "-2", "0". */
export function formatGain(g: number): string {
	const v = shownField('gain', g);
	return `${v > 0 ? '+' : ''}${v}`;
}

/** "+3.5 dB", "-2 dB", "0 dB". */
export function formatDb(g: number): string {
	return `${formatGain(g)} dB`;
}

/** "0.98", "0.707". */
export function formatQ(q: number): string {
	return String(shownField('q', q));
}
