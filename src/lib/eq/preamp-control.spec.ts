import { describe, expect, it } from 'vitest';
import type { Profile } from '@potatosalad775/eqcaps-core';
import { softwareProfile } from './__fixtures__/profiles';
import { preampControl } from './preamp-control';

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
