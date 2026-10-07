// Adapted from modernGraphTool src/lib/utils/eq-preamp.ts @ 23ddc4dd: our `biquad.ts` instead of
// its `Equalizer` (so every eqcaps type counts, a resonant high-pass included), no per-ear pass,
// never a positive preamp, and rounded towards more headroom.
import { combinedResponseDb } from './biquad';
import type { EqFilter } from './model';

/** 1/48 octave, 20 Hz to 20 kHz: where the preamp looks for the largest boost. */
const PREAMP_GRID = Array.from({ length: 480 }, (_, i) => 20 * Math.pow(1000, i / 479));

/**
 * The preamp for a band list: minus the largest boost the enabled bands apply, to 0.1 dB, so the EQ
 * can't clip. 0 when nothing boosts: a cut-only EQ gets no make-up gain.
 */
export function derivePreamp(filters: EqFilter[]): number {
	const enabled = filters.filter((f) => f.enabled);
	if (!enabled.length) return 0;
	// Every band's own centre is sampled too: a narrow boost peaks there, and a grid that straddles
	// it under-reads the peak (by up to 0.9 dB at Q 6 on a 100-point grid).
	const freqs = [...PREAMP_GRID, ...enabled.map((f) => f.freq)];
	const peak = Math.max(0, ...combinedResponseDb(enabled, freqs));
	// Round up, so a 6.04 dB peak gets -6.1, not -6.0. The epsilon keeps an exact 6 at -6.
	return -Math.ceil(peak * 10 - 1e-6) / 10 || 0;
}
