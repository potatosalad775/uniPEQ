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
	'tone-treble': m.device_control_treble
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
