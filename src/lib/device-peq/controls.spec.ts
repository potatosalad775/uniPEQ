import type { Control } from '@potatosalad775/eqcaps-core';
import { describe, expect, it } from 'vitest';
import { balanceLabel, balanceOf, balanceValue, balanceWrites, controlLabel } from './controls';

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
