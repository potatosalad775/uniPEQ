/**
 * How a device control is named in the app. The data names each control as its vendor's app does
 * ("GAME", "UAC"); its `role` gives one translated name across devices, and the data's name is the
 * fallback for a role this app doesn't know. Values keep the device's own names ("Fast Linear").
 */
import type { Control } from '@potatosalad775/eqcaps-core';
import * as m from '#lib/paraglide/messages.js';

const ROLE_LABELS: Record<NonNullable<Control['role']>, () => string> = {
	volume: m.device_control_volume,
	'output-gain': m.device_control_output_gain,
	'dac-filter': m.device_control_dac_filter,
	upsampling: m.device_control_upsampling,
	'usb-mode': m.device_control_usb_mode,
	'sound-mode': m.device_control_sound_mode,
	light: m.device_control_light,
	'tone-bass': m.device_control_bass,
	'tone-treble': m.device_control_treble,
	'amp-mode': m.device_control_amp_mode,
	'mic-gain': m.device_control_mic_gain,
	'balance-left': m.device_control_left_channel,
	'balance-right': m.device_control_right_channel,
	'noise-control': m.device_control_noise_control,
	'mic-noise-reduction': m.device_control_mic_noise_reduction,
	'prompt-tone': m.device_control_prompt_tone,
	'prompt-tone-volume': m.device_control_prompt_tone_volume,
	mute: m.device_control_mute,
	input: m.device_control_input,
	output: m.device_control_output,
	balance: m.device_control_balance,
	polarity: m.device_control_polarity,
	crossfeed: m.device_control_crossfeed,
	'display-brightness': m.device_control_display_brightness,
	headroom: m.device_control_headroom
};

export function controlLabel(control: Control): string {
	const label = control.role ? ROLE_LABELS[control.role] : undefined;
	return label ? label() : control.name;
}

/** A value as the device names it, or as a number (with its unit) for a range. */
export function controlValueLabel(control: Control, value: number): string {
	if (control.kind === 'toggle') {
		return value === 1 ? m.device_control_on() : m.device_control_off();
	}
	const named = control.values?.find((v) => v.value === value);
	if (named) return named.name;
	return control.unit === 'dB' ? `${value} dB` : String(value);
}

/**
 * Where a control is shown. One with `eq` is a setting of one of the device's EQs rather than of
 * the device (a Qudelix's headroom per EQ, its user EQ's crossfeed): it goes on the band card with
 * that EQ, so its place says whose it is and two EQs' headrooms never sit side by side under one
 * name. The rest are the device's own, in the device panel.
 */
export function deviceControls(controls: readonly Control[]): Control[] {
	return controls.filter((c) => c.eq === undefined);
}

/**
 * The settings of EQ `eq` among `controls`: an id of the device's listed EQs, or undefined for the
 * EQ the profile describes, which has no id and which the data marks `eq: true`.
 */
export function eqControls(controls: readonly Control[], eq: string | undefined): Control[] {
	return controls.filter((c) => c.eq !== undefined && c.eq === (eq ?? true));
}

/** The most values a range can have and still be offered as segments in a row. */
const MAX_SEGMENTS = 3;

/**
 * The values of a range with so few steps that it is a choice rather than a slider (a headroom of
 * 0, -6 or -12 dB), in the order they are offered; null for every other control. A range that
 * only cuts runs from 0 down, so the choice starts at no cut, as vendor apps list it; any other
 * runs up.
 */
export function rangeChoices(control: Control): number[] | null {
	const range = control.range;
	if (control.kind !== 'range' || !range || !('step' in range)) return null;
	const steps = Math.round((range.max - range.min) / range.step);
	if (steps < 1 || steps >= MAX_SEGMENTS) return null;
	// Off the grid's float noise (0.1 steps), as the data writes the values.
	const values = Array.from(
		{ length: steps + 1 },
		(_, i) => Math.round((range.min + i * range.step) * 1e10) / 1e10
	);
	return range.max <= 0 ? values.reverse() : values;
}

/**
 * A device that holds a gain per output channel shown as one balance, as vendor apps show it:
 * `n` > 0 cuts the left channel by `n`, `n` < 0 the right, 0 leaves both at their top. Two sliders
 * that each only cut would also let both channels drop, which is a second volume. Only a pair of
 * ranges on one grid that don't restart the device is merged; any other stays two rows.
 */
export type Balance = {
	left: Control;
	right: Control;
	min: number;
	max: number;
	step: number | 'any';
};

export function balanceOf(controls: Control[]): Balance | null {
	const left = controls.find((c) => c.role === 'balance-left');
	const right = controls.find((c) => c.role === 'balance-right');
	const l = left?.range;
	const r = right?.range;
	if (!left || !right || !l || !r || left.reconnect || right.reconnect) return null;
	const step = 'step' in l ? l.step : 'any';
	if (step !== ('step' in r ? r.step : 'any')) return null;
	return { left, right, min: r.min - r.max, max: l.max - l.min, step };
}

/** The balance the device's two gains make; one where both are cut still reads as their difference. */
export function balanceValue(balance: Balance, values: Record<string, number | null>): number {
	const { left, right } = balance;
	const cut = (c: Control) => c.range!.max - (values[c.id] ?? c.range!.max);
	return cut(left) - cut(right);
}

/**
 * The writes that set the balance to `n`, those that lower a gain first, so the sound is never
 * louder on the way than at either end. A gain already where it should be is left alone.
 */
export function balanceWrites(
	balance: Balance,
	n: number,
	values: Record<string, number | null>
): [id: string, value: number][] {
	const { left, right } = balance;
	const target: [Control, number][] = [
		[left, left.range!.max - Math.max(n, 0)],
		[right, right.range!.max + Math.min(n, 0)]
	];
	const delta = ([c, v]: [Control, number]) => v - (values[c.id] ?? c.range!.max);
	return target
		.filter((t) => delta(t) !== 0)
		.sort((a, b) => delta(a) - delta(b))
		.map(([c, v]) => [c.id, v]);
}

/** A balance as the channel it cuts and by how much ("Left -6 dB"), or centred. */
export function balanceLabel(balance: Balance, n: number): string {
	if (n === 0) return m.device_control_balance_center();
	const unit = balance.left.unit === 'dB' ? ' dB' : '';
	const gain = `-${Math.abs(n)}${unit}`;
	return n > 0 ? m.device_control_balance_left({ gain }) : m.device_control_balance_right({ gain });
}
