// Adapted from modernGraphTool src/lib/utils/eq-apo.ts @ 23ddc4dd: every eqcaps type (APO's own
// codes), Q from `BW Oct`, `Preamp:` kept (a preset carries its pregain), and one-ear sections
// skipped and counted, since the app has no per-channel bands.
import type { EqFilter, FilterType } from './model';

/**
 * Equalizer APO parametric-config text, parse and emit. The dialect AutoEq's `ParametricEQ.txt`,
 * Squiglink tools and Equalizer APO itself all speak:
 *
 * ```
 * Preamp: -6.3 dB
 * Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41
 * Filter 2: ON LSC Fc 105 Hz Gain 2.0 dB Q 0.7
 * Filter 3: OFF HPQ Fc 20 Hz Q 0.707
 * ```
 *
 * eqcaps type codes are APO's, so a type maps to itself; APO's shorthand names (`LS`, `HP`, …)
 * map onto them.
 */

const TYPE_FROM_APO: Record<string, FilterType> = {
	PK: 'PK',
	PEQ: 'PK',
	LSC: 'LSC',
	LS: 'LSC',
	LSQ: 'LSC',
	HSC: 'HSC',
	HS: 'HSC',
	HSQ: 'HSC',
	LPQ: 'LPQ',
	LP: 'LPQ',
	HPQ: 'HPQ',
	HP: 'HPQ',
	BP: 'BP',
	NO: 'NO',
	AP: 'AP'
};

/** Types APO writes without a Q (Butterworth, 0.707) when none is given. */
const DEFAULT_Q_TYPES = new Set(['LS', 'HS', 'LP', 'HP', 'LSC', 'HSC', 'LPQ', 'HPQ']);
const BUTTERWORTH_Q = 0.707;

const GAINLESS = new Set<FilterType>(['LPQ', 'HPQ', 'BP', 'NO', 'AP']);

export interface ApoImport {
	filters: EqFilter[];
	/** The sum of the `Preamp:` lines (APO adds them up), or null when there are none. */
	preamp: number | null;
	/**
	 * `Filter` lines left out: a type with no eqcaps code (or a slope variant such as `LS 6dB`), a
	 * line missing a value, or a band in a left- or right-only `Channel:` section.
	 */
	skipped: number;
}

const FILTER_LINE = /^Filter\s*\d*\s*:\s*(?:(ON|OFF)\s+)?([A-Za-z]+)\b(.*)$/i;
const FC = /\bFc\s+([+-]?[\d.]+)\s*Hz/i;
const GAIN = /\bGain\s+([+-]?[\d.]+)\s*dB/i;
const Q = /\bQ\s+([\d.]+)/i;
const BW_OCT = /\bBW\s+Oct\s+([\d.]+)/i;
/** `LS 6dB Fc …`: a shelf of another order, which no eqcaps type describes. */
const SLOPE = /^\s*\d+(?:\.\d+)?\s*dB\b/i;

/** Q from a bandwidth in octaves, as APO converts it. */
function qFromOctaves(n: number): number {
	const p = Math.pow(2, n);
	return Math.round((Math.sqrt(p) / (p - 1)) * 10000) / 10000;
}

/**
 * Whether a `Channel:` directive scopes the lines after it to one ear only. `ALL`, both ears, or
 * anything unrecognised count as shared, rather than dropping the filters that follow.
 */
function isOneEar(value: string): boolean {
	const tokens = value
		.trim()
		.toUpperCase()
		.split(/[\s,]+/)
		.filter(Boolean);
	if (tokens.includes('ALL')) return false;
	return tokens.includes('L') !== tokens.includes('R');
}

/**
 * Parse an Equalizer APO parametric config. Lines that aren't `Preamp`, `Channel` or `Filter`
 * (comments, `Include:`, `Convolution:`) are ignored, so a full config still yields its filters.
 */
export function parseApo(text: string): ApoImport {
	const filters: EqFilter[] = [];
	let preamp: number | null = null;
	let skipped = 0;
	let oneEar = false;

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;

		const preampMatch = line.match(/^Preamp\s*:\s*([+-]?[\d.]+)\s*dB/i);
		if (preampMatch) {
			preamp = (preamp ?? 0) + parseFloat(preampMatch[1]);
			continue;
		}
		const channelMatch = line.match(/^Channel\s*:\s*(.*)$/i);
		if (channelMatch) {
			oneEar = isOneEar(channelMatch[1]);
			continue;
		}
		const match = line.match(FILTER_LINE);
		if (!match) continue;

		const [, onOff, rawType, rest] = match;
		// An OFF band plays nothing, and the app has no switched-off bands: leave it out.
		if (onOff?.toUpperCase() === 'OFF') continue;
		const name = rawType.toUpperCase();
		const type = TYPE_FROM_APO[name];
		const freq = parseFloat(rest.match(FC)?.[1] ?? '');
		const gainText = rest.match(GAIN)?.[1];
		const qText = rest.match(Q)?.[1];
		const bwText = rest.match(BW_OCT)?.[1];
		const q =
			qText !== undefined
				? parseFloat(qText)
				: bwText !== undefined
					? qFromOctaves(parseFloat(bwText))
					: DEFAULT_Q_TYPES.has(name)
						? BUTTERWORTH_Q
						: NaN;
		const gain = type && GAINLESS.has(type) ? 0 : parseFloat(gainText ?? '');
		if (oneEar || !type || SLOPE.test(rest) || !(freq > 0) || !(q > 0) || !Number.isFinite(gain)) {
			skipped++;
			continue;
		}
		filters.push({ type, freq, q, gain });
	}

	return { filters, preamp, skipped };
}

const num = (value: number, places: number) => String(+value.toFixed(places));

/**
 * Emit an Equalizer APO parametric config, every band `ON`; it round-trips through `parseApo`.
 * Types without gain are written without it.
 */
export function formatApo(filters: EqFilter[], preamp: number): string {
	let text = `Preamp: ${preamp.toFixed(1)} dB\n`;
	filters.forEach((f, i) => {
		const gain = GAINLESS.has(f.type) ? '' : ` Gain ${num(f.gain, 2)} dB`;
		text += `Filter ${i + 1}: ON ${f.type} Fc ${num(f.freq, 2)} Hz` + `${gain} Q ${num(f.q, 3)}\n`;
	});
	return text;
}
