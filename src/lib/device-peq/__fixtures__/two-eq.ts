/**
 * A device with two EQs, as a Qudelix 5K has them: its user EQ ("USR EQ", the profile's own, 10
 * bands, one channel) and a headphone EQ `spk` ("SPK EQ", 20 bands, its left and right driven
 * apart, presets of its own). In single-EQ mode (`state.single`) the user EQ is one 20-band EQ and
 * any operation on `spk` is refused as `unsupported`, as the bridge's Qudelix handler does. The
 * device keeps what is written to it, and records each call with the EQ it was made on (the view,
 * `conn.device.eq(id)`). Each EQ is on a
 * preset (`state.preset`) or on none (null, an edited EQ, which `currentSlot` answers as null): a
 * write naming a preset saves there and plays it, one naming none leaves the EQ on none, and
 * switching the EQ on with a preset loads it, as a Qudelix does. Each EQ's switch is its own.
 */
import type { Filter, Preset } from '@potatosalad775/eqcaps-core';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import type { PushRequest } from '../types';
import { fakeConnection, type FakeEq } from './connection';

const pk = (freq: number, gain: number): Filter => ({ type: 'PK', freq, q: 1, gain });
/** `count` bands from 25 Hz up, each `gain(i)` dB. */
const bands = (count: number, gain: (i: number) => number) =>
	Array.from({ length: count }, (_, i) => pk(Math.round(25 * 1.4 ** i), gain(i)));

const USR_PRESETS: Preset[] = [
	{ id: 0, name: 'Flat' },
	{ id: 1, name: 'Acoustic' },
	{ id: 22, name: 'Custom #1', writable: true },
	{ id: 23, name: 'Custom #2', writable: true }
];
const SPK_PRESETS: Preset[] = [
	{ id: 0, name: 'Flat' },
	{ id: 22, name: 'Custom #1', writable: true },
	{ id: 23, name: 'Custom #2', writable: true }
];
const SPK: FakeEq = {
	id: 'spk',
	name: 'SPK EQ',
	bandCount: 20,
	channels: 'independent',
	presets: SPK_PRESETS,
	perChannel: true
};

/** A refusal as the bridge throws it, by its code. */
export function bridgeError(code: string, message = code): Error {
	return Object.assign(new Error(message), { name: 'BridgeError', code });
}

/** `preset` is the one both EQs start on: null for none. */
export function twoEqDevice({ single = false, preset = 22 as number | null } = {}) {
	const state = {
		single,
		preset: { usr: preset, spk: preset },
		enabled: { usr: true, spk: true },
		usr: { filters: bands(10, (i) => (i % 2 ? -2 : 2)), preamp: -2 },
		all: { filters: bands(20, () => 1), preamp: -4 },
		spk: {
			left: bands(20, (i) => (i < 4 ? 3 : 0)),
			right: bands(20, (i) => (i < 4 ? -3 : 0)),
			preamp: -9
		}
	};
	const calls: { op: string; eq: string | undefined }[] = [];
	/** The EQ an operation is on, refused as a single-EQ mode refuses the headphone EQ. */
	const on = (op: string, eq: string | undefined) => {
		calls.push({ op, eq });
		if (eq === 'spk' && state.single) throw bridgeError('unsupported', 'no speaker EQ');
		return eq;
	};
	const profile = {
		...hardwareProfile('two-eq-dac', { bandCount: 10 }),
		device: { brand: 'Spec', model: 'Two-EQ DAC' },
		engine: 'USR EQ',
		protocol: { handler: 'fake', presets: USR_PRESETS }
	};
	const conn = fakeConnection(
		profile,
		{
			canEnable: true,
			readsEnabled: true,
			readsCurrentSlot: true,
			writesSlot: true,
			readsBandCount: true,
			slots: USR_PRESETS
		},
		[SPK]
	);
	for (const eq of [undefined, 'spk'] as const) {
		const d = conn.device.eq(eq);
		const which = eq ?? 'usr';
		d.pull = async () => {
			if (on('pull', eq) === 'spk') {
				const { left, right, preamp } = state.spk;
				return { filters: left, preamp, right: { filters: right, preamp } };
			}
			return state.single ? state.all : state.usr;
		};
		d.push = async (r: PushRequest) => {
			if (on('push', eq) === 'spk') {
				state.spk.left = [...r.filters];
				state.spk.right = [...(r.right?.filters ?? r.filters)];
			} else if (state.single) state.all = { filters: [...r.filters], preamp: r.preamp ?? 0 };
			else state.usr = { filters: [...r.filters], preamp: r.preamp ?? 0 };
			state.preset[which] = r.slot ?? null;
			return { reconnect: false };
		};
		d.currentSlot = async () => (on('currentSlot', eq), state.preset[which]);
		d.eqEnabled = async () => (on('eqEnabled', eq), state.enabled[which]);
		d.setEnabled = async (enabled, slot) => {
			on('setEnabled', eq);
			state.enabled[which] = enabled;
			if (enabled && slot !== undefined) state.preset[which] = slot;
		};
		// The bridge reads no band count of an EQ the mode lacks: null, not an error.
		d.bandCount = async () => {
			calls.push({ op: 'bandCount', eq });
			if (eq === 'spk') return state.single ? null : 20;
			return state.single ? 20 : 10;
		};
	}
	return { conn, state, calls };
}
