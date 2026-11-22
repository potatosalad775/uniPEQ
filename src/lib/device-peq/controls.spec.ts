import type { Control } from '@potatosalad775/eqcaps-core';
import { describe, expect, it } from 'vitest';
import {
	balanceLabel,
	balanceOf,
	balanceValue,
	balanceWrites,
	controlLabel,
	deviceControls,
	eqControls,
	rangeChoices
} from './controls';

const gain = (id: string, role: Control['role'], extra: Partial<Control> = {}): Control => ({
	id,
	name: id,
	kind: 'range',
	role,
	range: { min: -50, max: 0, step: 1 },
	unit: 'dB',
	...extra
});
const LEFT = gain('leftGain', 'balance-left');
const RIGHT = gain('rightGain', 'balance-right');

describe('balanceOf', () => {
	it('merges a gain per channel into one balance across both cuts', () => {
		expect(balanceOf([LEFT, RIGHT])).toEqual({
			left: LEFT,
			right: RIGHT,
			min: -50,
			max: 50,
			step: 1
		});
	});

	it('leaves a channel alone, or a pair on different grids or that restarts the device', () => {
		expect(balanceOf([LEFT])).toBeNull();
		expect(
			balanceOf([
				LEFT,
				gain('rightGain', 'balance-right', { range: { min: -50, max: 0, step: 0.5 } })
			])
		).toBeNull();
		expect(balanceOf([LEFT, gain('rightGain', 'balance-right', { reconnect: true })])).toBeNull();
	});
});

describe('balance', () => {
	const balance = balanceOf([LEFT, RIGHT])!;

	it('reads a cut left channel as positive, a cut right one as negative', () => {
		expect(balanceValue(balance, { leftGain: 0, rightGain: 0 })).toBe(0);
		expect(balanceValue(balance, { leftGain: -6, rightGain: 0 })).toBe(6);
		expect(balanceValue(balance, { leftGain: 0, rightGain: -6 })).toBe(-6);
		expect(balanceValue(balance, { leftGain: -10, rightGain: -4 })).toBe(6);
	});

	it('cuts one channel and lifts the other to the top, lowering first', () => {
		expect(balanceWrites(balance, -6, { leftGain: -3, rightGain: 0 })).toEqual([
			['rightGain', -6],
			['leftGain', 0]
		]);
		expect(balanceWrites(balance, 6, { leftGain: 0, rightGain: -3 })).toEqual([
			['leftGain', -6],
			['rightGain', 0]
		]);
	});

	it('writes only the gains that change', () => {
		expect(balanceWrites(balance, 8, { leftGain: -6, rightGain: 0 })).toEqual([['leftGain', -8]]);
		expect(balanceWrites(balance, 0, { leftGain: 0, rightGain: 0 })).toEqual([]);
	});

	it('names the channel it cuts', () => {
		expect(balanceLabel(balance, 0)).toBe('Center');
		expect(balanceLabel(balance, 6)).toBe('Left -6 dB');
		expect(balanceLabel(balance, -6)).toBe('Right -6 dB');
	});

	it('names each channel under its role when not merged', () => {
		expect(controlLabel(LEFT)).toBe('Left channel');
	});
});

describe('where a control is shown', () => {
	const headroom = (id: string, eq: true | string): Control => ({
		id,
		name: id,
		kind: 'range',
		role: 'headroom',
		eq,
		range: { min: -12, max: 0, step: 6 },
		unit: 'dB'
	});
	const OWN = headroom('headroom', true);
	const SPK = headroom('headroomSpk', 'spk');
	const CROSSFEED: Control = {
		id: 'crossfeed',
		name: 'QX-FEED',
		kind: 'range',
		role: 'crossfeed',
		eq: true,
		range: { min: 0, max: 50, step: 1 }
	};
	const FILTER: Control = {
		id: 'dacFilter',
		name: 'FILTER SELECTION',
		kind: 'choice',
		role: 'dac-filter',
		values: [
			{ value: 0, name: 'Fast' },
			{ value: 1, name: 'Slow' }
		]
	};
	const ALL = [OWN, SPK, CROSSFEED, FILTER, LEFT];

	it("keeps the device's own settings for the device panel", () => {
		expect(deviceControls(ALL)).toEqual([FILTER, LEFT]);
	});

	it("gives the EQ the profile describes the ones marked true, in the profile's order", () => {
		expect(eqControls(ALL, undefined)).toEqual([OWN, CROSSFEED]);
	});

	it('gives a listed EQ the ones naming its id, and an EQ without settings none', () => {
		expect(eqControls(ALL, 'spk')).toEqual([SPK]);
		expect(eqControls(ALL, 'mic')).toEqual([]);
		expect(eqControls([FILTER, LEFT], undefined)).toEqual([]);
	});

	it('shows every control in one place only', () => {
		const placed = [
			...deviceControls(ALL),
			...eqControls(ALL, undefined),
			...eqControls(ALL, 'spk')
		];
		expect(placed).toHaveLength(ALL.length);
		expect(new Set(placed)).toEqual(new Set(ALL));
	});

	it('names a headroom by its role', () => {
		expect(controlLabel(OWN)).toBe('Headroom');
		expect(controlLabel(SPK)).toBe('Headroom');
	});
});

describe('rangeChoices', () => {
	const range = (r: NonNullable<Control['range']>, extra: Partial<Control> = {}): Control => ({
		id: 'x',
		name: 'x',
		kind: 'range',
		range: r,
		...extra
	});

	it('offers a range of three values as a choice, a cut from none down', () => {
		expect(rangeChoices(range({ min: -12, max: 0, step: 6 }))).toEqual([0, -6, -12]);
	});

	it('runs any other range up, on its grid', () => {
		expect(rangeChoices(range({ min: 0, max: 2, step: 1 }))).toEqual([0, 1, 2]);
		expect(rangeChoices(range({ min: -1, max: 1, step: 1 }))).toEqual([-1, 0, 1]);
		expect(rangeChoices(range({ min: 0.1, max: 0.3, step: 0.1 }))).toEqual([0.1, 0.2, 0.3]);
		expect(rangeChoices(range({ min: 0, max: 1, step: 1 }))).toEqual([0, 1]);
	});

	it('leaves a longer range, or one without steps, a slider', () => {
		expect(rangeChoices(range({ min: 0, max: 50, step: 1 }))).toBeNull();
		expect(rangeChoices(range({ min: 0, max: 3, step: 1 }))).toBeNull();
		expect(rangeChoices(range({ min: -12, max: 0 }))).toBeNull();
	});

	it('is only for a range', () => {
		expect(rangeChoices({ id: 'led', name: 'LED', kind: 'toggle' })).toBeNull();
	});
});
