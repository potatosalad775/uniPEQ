import type { BadgeTone } from '#lib/components/atoms/Badge.svelte';
import type { PresetFit } from '#lib/device-peq/preset-fit.js';
import { PresetError } from '#lib/eq/preset-file.js';
import * as m from '#lib/paraglide/messages.js';

/** Each warning a load or import came with, after its own message. */
export function withWarnings(text: string, w: { dropped: number; skipped?: number }): string {
	const parts = [text];
	if (w.dropped > 0) parts.push(m.presets_dropped_bands({ count: w.dropped }));
	if (w.skipped) parts.push(m.presets_skipped_lines({ count: w.skipped }));
	return parts.join(' ');
}

export function describePresetError(e: unknown): string {
	if (e instanceof PresetError) {
		if (e.code === 'not-a-preset') return m.presets_error_not_a_preset();
		if (e.code === 'version') return m.presets_error_version();
		if (e.code === 'empty') return m.presets_error_empty();
		return m.presets_error_invalid({ detail: e.message });
	}
	return m.presets_error_generic();
}

/** A preset's fit to the connected device, as a badge. */
export function fitBadge(fit: PresetFit): { text: string; tone: BadgeTone } {
	if (fit.kind === 'exact') return { text: m.presets_fit_exact(), tone: 'success' };
	if (fit.kind === 'adjusted') {
		return { text: m.presets_fit_adjusted({ count: fit.changes }), tone: 'warning' };
	}
	return {
		text: fit.dropped > 0 ? m.presets_fit_dropped({ count: fit.dropped }) : m.presets_fit_rules(),
		tone: 'error'
	};
}
