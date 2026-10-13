import { describe, expect, it } from 'vitest';
import type { Profile } from '@potatosalad775/eqcaps-core';
import { softwareProfile } from './__fixtures__/profiles';
import { headroomPreamp, preampControl } from './preamp-control';

const withPreamp = (preamp: Profile['preamp']): Profile => ({ ...softwareProfile('p'), preamp });

describe('preampControl', () => {
	it("gives a manual preamp a slider over the device's range", () => {
		const c = preampControl(
			withPreamp({ mode: 'manual', gain: { min: -12, max: 0, step: 0.5 } }),
			true
		);
		expect(c).toMatchObject({ kind: 'slider', min: -12, max: 0, step: 0.5, unknown: false });
	});

	it('hides it where the device sets its own', () => {
		expect(preampControl(withPreamp({ mode: 'auto' }), true)).toEqual({ kind: 'auto' });
	});

	it('has none to show where the device has none, or the protocol cannot send one', () => {
		expect(preampControl(withPreamp({ mode: 'none' }), true)).toEqual({ kind: 'none' });
		const manual = withPreamp({ mode: 'manual', gain: { min: -12, max: 0 } });
		expect(preampControl(manual, false)).toEqual({ kind: 'none' });
	});

	it('guesses a cut-only range for an unknown preamp, and says so', () => {
		const c = preampControl(withPreamp({ mode: 'unknown' }), true);
		expect(c).toMatchObject({ kind: 'slider', min: -20, max: 0, unknown: true });
	});

	it('keeps the slider with no device', () => {
		const c = preampControl(withPreamp({ mode: 'manual', gain: { min: -30, max: 10 } }), null);
		expect(c).toMatchObject({ kind: 'slider', min: -30, max: 10, step: 0.1 });
	});
});

describe('headroomPreamp', () => {
	const slider = (gain: Profile['preamp'] & { mode: 'manual' }) =>
		preampControl(withPreamp(gain), true);

	it('moves down onto a coarse grid, never up', () => {
		const c = slider({ mode: 'manual', gain: { min: -12, max: 0, step: 1 } });
		expect(headroomPreamp(-6.1, c)).toBe(-7);
		expect(headroomPreamp(-6, c)).toBe(-6);
		expect(headroomPreamp(-0.3, c)).toBe(-1);
	});

	it("stops at the device's range, and picks from a set", () => {
		expect(
			headroomPreamp(-20, slider({ mode: 'manual', gain: { min: -12, max: 0, step: 0.5 } }))
		).toBe(-12);
		expect(headroomPreamp(-4, slider({ mode: 'manual', gain: { values: [-9, -6, -3, 0] } }))).toBe(
			-6
		);
		expect(headroomPreamp(-2.34, slider({ mode: 'manual', gain: { min: -12, max: 0 } }))).toBe(
			-2.34
		);
	});

	it('leaves the value alone where no preamp is written', () => {
		expect(headroomPreamp(-6.1, preampControl(withPreamp({ mode: 'none' }), true))).toBe(-6.1);
	});
});
