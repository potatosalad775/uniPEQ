import { describe, expect, it } from 'vitest';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import type { EqFilter } from '$lib/eq/model';
import { presetFit } from './preset-fit';

const profile = hardwareProfile('h', {
	bandCount: 2,
	band: {
		types: ['PK'],
		freq: { min: 20, max: 20000, step: 1 },
		q: { min: 0.1, max: 10, step: 0.01 },
		gain: { min: -12, max: 12, step: 0.1 }
	}
});
const caps = { writesPreamp: true };
const band = (type: EqFilter['type'], freq: number, gain: number): EqFilter => ({
	type,
	freq,
	q: 1,
	gain
});

describe('presetFit', () => {
	it('fits a preset the device holds as it is', () => {
		expect(presetFit({ filters: [band('PK', 100, 3)], pregain: -3 }, profile, caps)).toEqual({
			kind: 'exact'
		});
	});

	it('counts the values fit moves', () => {
		const fit = presetFit({ filters: [band('LSC', 100, 3)], pregain: -3 }, profile, caps);
		expect(fit).toEqual({ kind: 'adjusted', changes: 1 });
	});

	it('calls a preset with more bands than slots lossy', () => {
		const filters = [band('PK', 100, 3), band('PK', 1000, -2), band('PK', 5000, 1)];
		expect(presetFit({ filters, pregain: 'auto' }, profile, caps)).toEqual({
			kind: 'lossy',
			dropped: 1
		});
	});
});
