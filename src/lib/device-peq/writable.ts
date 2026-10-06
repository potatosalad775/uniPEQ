/**
 * Which EQ presets the user can write, per eqcaps profile (rebuild decision 1). eqcaps presets
 * carry no such flag yet (task E1), and writing over a built-in preset ("Jazz") either fails or
 * replaces a vendor curve. This temporary table lists the user memories of every profile that
 * mixes them with built-ins; it goes once E1's `writable` ships.
 *
 * Profiles not listed have only writable presets (a walkplay dongle's one "Custom"), or presets
 * nobody has sorted yet; both stay unrestricted. `writable.spec.ts` checks the table against the
 * embedded snapshot, so a renamed or added preset fails a test instead of drifting.
 */
import type { Slot } from '@potatosalad775/eqcaps-device-bridge';

const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

const USER_160_169 = range(160, 169);
const USER_160_162 = range(160, 162);
const USER_7_16 = range(7, 16);

export const WRITABLE_PRESETS: Readonly<Record<string, readonly number[]>> = {
	'fiio-air-amp': USER_160_169,
	'fiio-air-link': [4, 8, 9],
	'fiio-audio-dsp': USER_160_169,
	'fiio-br15-r2r': USER_160_169,
	'fiio-bt11': [4, 8, 9],
	'fiio-btr13': [7, 8, 9],
	'fiio-btr17': USER_160_169,
	'fiio-dm15-r2r': USER_160_169,
	'fiio-fg3': USER_160_169,
	'fiio-fp3': [160],
	'fiio-fx17': [160],
	'fiio-k13-r2r': USER_160_169,
	'fiio-k15': USER_7_16,
	'fiio-k17': USER_7_16,
	'fiio-k19': USER_7_16,
	'fiio-ka15': [7, 8, 9],
	'fiio-ka17': [4, 8, 9],
	'fiio-ls-tc2': [160],
	'fiio-oak-nano': [160],
	'fiio-q7': [4, 8, 9],
	'fiio-qx11': USER_160_169,
	'fiio-qx13': USER_160_169,
	'fiio-retro-nano': USER_160_162,
	'fosi-audio-ds3': range(7, 11),
	'jadeaudio-ja11': [3],
	'jadeaudio-jiezi': USER_160_162,
	'nothing-headphone-1': [5],
	'snowsky-melody': USER_160_162,
	'snowsky-tiny-a': USER_160_162,
	'snowsky-tiny-b': USER_160_162
};

/**
 * The presets of `slots` a write may target: the listed ones for a known profile, else every
 * non-bypass preset. A guessed device (no profile id) is unrestricted too: it has no list to go by.
 */
export function writableSlots(profileId: string | null, slots: readonly Slot[]): Slot[] {
	const memories = slots.filter((s) => !s.bypass);
	const listed = profileId ? WRITABLE_PRESETS[profileId] : undefined;
	return listed ? memories.filter((s) => listed.includes(s.id)) : memories;
}
