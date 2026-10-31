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
	'balance-right': m.device_control_right_channel
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
