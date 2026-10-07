import type { FilterType } from '$lib/eq/model';
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

/** "1.23 kHz", "84.5 Hz". */
export function formatHz(f: number): string {
	return f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`;
}

/** "+3.5 dB", "-2 dB", "0 dB". */
export function formatDb(g: number): string {
	return `${g > 0 ? '+' : ''}${+g.toFixed(2)} dB`;
}

/** Q to at most three decimals. */
export function formatQ(q: number): string {
	return String(+q.toFixed(3));
}
