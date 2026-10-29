/**
 * A Fosi Audio DS3 with its controls as eqcaps lists them, simulated the way the bridge drives
 * them: `readControls` gives null for a control whose firmware range or `when` doesn't hold, and
 * `writeControl` reports `reconnect` for USB mode and game mode, which restart the device.
 */
import { controlPresent, type Control } from '@potatosalad775/eqcaps-core';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { fakeConnection } from './connection';

export const DS3_CONTROLS: Control[] = [
	{
		id: 'uacMode',
		name: 'UAC',
		kind: 'choice',
		role: 'usb-mode',
		values: [
			{ value: 0, name: 'UAC 2.0' },
			{ value: 1, name: 'UAC 1.0' }
		],
		reconnect: true
	},
	{
		id: 'filterMode',
		name: 'Filter',
		kind: 'choice',
		role: 'dac-filter',
		values: [
			{ value: 0, name: 'Min Phase' },
			{ value: 1, name: 'Apodizing' },
			{ value: 2, name: 'Fast Linear' }
		],
		when: { control: 'uacMode', values: [0] }
	},
	{
		id: 'upsample',
		name: 'Upsample',
		kind: 'toggle',
		role: 'upsampling',
		when: { control: 'uacMode', values: [0] },
		firmware: { min: '1.4.9' },
		disablesEq: [1]
	},
	{
		id: 'gameMode',
		name: 'GAME',
		kind: 'choice',
		role: 'sound-mode',
		values: [
			{ value: 0, name: 'NONE' },
			{ value: 1, name: 'FPS' },
			{ value: 2, name: '7.1' }
		],
		when: { control: 'uacMode', values: [1] },
		reconnect: true
	},
	{
		id: 'volume',
		name: 'Volume',
		kind: 'range',
		role: 'volume',
		range: { min: 0, max: 60, step: 1 }
	},
	{ id: 'led', name: 'LED', kind: 'toggle', role: 'light' }
];

/** A connected DS3 holding `values` (what its controls are set to), on `firmware`. */
export function ds3Connection(
	values: Record<string, number> = {
		uacMode: 0,
		filterMode: 2,
		upsample: 0,
		gameMode: 0,
		volume: 24,
		led: 1
	},
	firmware = '1.6.10'
) {
	const conn = fakeConnection(hardwareProfile('fosi-audio-ds3', { bandCount: 32 }), {
		readsFirmware: true,
		controls: DS3_CONTROLS
	});
	const state = { ...values };
	const read = () =>
		Object.fromEntries(
			DS3_CONTROLS.map((c) => [
				c.id,
				controlPresent(c, { firmware, values: state }) ? (state[c.id] ?? 0) : null
			])
		);
	Object.assign(conn.device, {
		firmware: async () => firmware,
		readControls: async () => read(),
		writeControl: async (id: string, value: number) => {
			state[id] = value;
			return { reconnect: !!DS3_CONTROLS.find((c) => c.id === id)?.reconnect };
		}
	});
	return { conn, state };
}
