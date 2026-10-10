import { describe, expect, it } from 'vitest';
import type { PeqPreset } from './model';
import {
	createPreset,
	editedPreset,
	importPreset,
	parsePreset,
	parseTags,
	PresetError,
	presetJson
} from './preset-file';

const V1 = {
	schemaVersion: 1,
	id: 'old',
	name: 'Prototype preset',
	tags: ['bass'],
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-02T00:00:00.000Z',
	source: { deviceId: 'fiio/ka17', app: 'uniPEQ', appVersion: '0.0.1' },
	pregain: -4,
	filters: [
		{ type: 'LSQ', freq: 105, gain: 4, q: 0.7 },
		{ type: 'NOTCH', freq: 50, gain: 0, q: 30, enabled: false },
		{ type: 'HPF', freq: 20, gain: 0, q: 0.707 },
		{ type: 'CQ', freq: 3000, gain: -2, q: 2 }
	]
};

function codeOf(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (e) {
		return e instanceof PresetError ? e.code : 'other';
	}
	return undefined;
}

describe('parsePreset', () => {
	it('migrates a v1 preset to the eqcaps type codes', () => {
		const { preset, dropped } = parsePreset(V1);
		expect(preset.schemaVersion).toBe(2);
		expect(preset.filters.map((f) => f.type)).toEqual(['LSC', 'HPQ']);
		expect(preset).toMatchObject({
			id: 'old',
			name: 'Prototype preset',
			tags: ['bass'],
			pregain: -4,
			createdAt: V1.createdAt,
			source: V1.source
		});
		expect(dropped).toBe(1);
	});

	it('drops a band saved switched off without counting it, and keeps no enabled field', () => {
		const { preset, dropped } = parsePreset({
			schemaVersion: 2,
			id: 'x',
			name: 'Old switches',
			filters: [
				{ type: 'PK', freq: 1000, q: 1, gain: 3, enabled: true },
				{ type: 'PK', freq: 2000, q: 1, gain: 9, enabled: false }
			]
		});
		expect(preset.filters).toEqual([{ type: 'PK', freq: 1000, q: 1, gain: 3 }]);
		expect(dropped).toBe(0);
	});

	it('reads a v2 preset back as it was written', () => {
		const v2 = parsePreset(V1).preset;
		expect(parsePreset(JSON.parse(presetJson(v2)))).toEqual({ preset: v2, dropped: 0 });
	});

	it('fills in what an older or hand-written file leaves out', () => {
		const { preset } = parsePreset({
			schemaVersion: 2,
			id: 'x',
			name: 'Bare',
			filters: [{ type: 'PK', freq: 1000, q: 1, gain: 3 }]
		});
		expect(preset.tags).toEqual([]);
		expect(preset.pregain).toBe('auto');
	});

	it('refuses what is not a preset, or a version it does not know', () => {
		expect(codeOf(() => parsePreset([1, 2]))).toBe('not-a-preset');
		expect(codeOf(() => parsePreset({ name: 'x' }))).toBe('not-a-preset');
		expect(codeOf(() => parsePreset({ ...V1, schemaVersion: 3 }))).toBe('version');
	});

	it('refuses bad fields, naming the band', () => {
		const bad = (filters: unknown[]) => () => parsePreset({ ...V1, schemaVersion: 2, filters });
		expect(codeOf(bad([{ type: 'LSQ', freq: 100, q: 1, gain: 0 }]))).toBe('invalid');
		expect(codeOf(bad([{ type: 'PK', freq: -1, q: 1, gain: 0 }]))).toBe('invalid');
		expect(codeOf(bad([{ type: 'PK', freq: 100, q: 1, gain: '3' }]))).toBe('invalid');
		expect(() => parsePreset({ ...V1, pregain: 'loud' })).toThrow(/pregain/);
		expect(() => parsePreset({ ...V1, filters: [null] })).toThrow(/filter 1/);
	});
});

describe('createPreset', () => {
	it('copies the bands and stamps the app', () => {
		const filters = [{ type: 'PK' as const, freq: 1000, q: 1, gain: 3 }];
		const preset = createPreset({ name: 'Mine', filters, pregain: 'auto', deviceId: 'fiio-ka17' });
		expect(preset.filters).toEqual(filters);
		expect(preset.filters[0]).not.toBe(filters[0]);
		expect(preset.source).toEqual({
			deviceId: 'fiio-ka17',
			app: 'uniPEQ',
			appVersion: __APP_VERSION__
		});
		expect(preset.createdAt).toBe(preset.updatedAt);
	});
});

describe('importPreset', () => {
	it('imports preset JSON under a fresh id', () => {
		const { preset, dropped } = importPreset(JSON.stringify(V1), 'old.json');
		expect(preset.id).not.toBe('old');
		expect(preset.name).toBe('Prototype preset');
		expect(dropped).toBe(1);
	});

	it('imports AutoEq text named after the file, with its preamp', () => {
		const text = 'Preamp: -5.2 dB\nFilter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1\n';
		const { preset, skipped } = importPreset(text, 'Sennheiser HD 600 ParametricEQ.txt');
		expect(preset.name).toBe('Sennheiser HD 600 ParametricEQ');
		expect(preset.pregain).toBe(-5.2);
		expect(preset.filters).toHaveLength(1);
		expect(skipped).toBe(0);
	});

	it('takes the preamp as auto when the text has none', () => {
		const { preset } = importPreset('Filter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1', 'x.txt');
		expect(preset.pregain).toBe('auto');
	});

	it('says whether a file is no preset at all or one with nothing usable', () => {
		expect(codeOf(() => importPreset('just some notes', 'notes.txt'))).toBe('not-a-preset');
		expect(codeOf(() => importPreset('Filter 1: ON XX Fc 1 Hz Gain 1 dB Q 1', 'x.txt'))).toBe(
			'empty'
		);
		expect(codeOf(() => importPreset('{"schemaVersion": 9}', 'x.json'))).toBe('version');
	});

	it('round-trips through its own export', () => {
		const original: PeqPreset = createPreset({
			name: 'Round',
			filters: [{ type: 'HSC', freq: 8000, q: 0.7, gain: -2 }],
			pregain: -1
		});
		const { preset } = importPreset(presetJson(original), 'Round.json');
		expect({ ...preset, id: original.id }).toEqual(original);
	});
});

describe('parseTags', () => {
	it('splits on commas, trims, and drops empties and repeats', () => {
		expect(parseTags(' bass, warm ,, bass,')).toEqual(['bass', 'warm']);
		expect(parseTags('')).toEqual([]);
	});
});

describe('editedPreset', () => {
	it('renames and retags, stamping the update', () => {
		const p = createPreset({ name: 'A', filters: [], pregain: 0 });
		const next = editedPreset({ ...p, updatedAt: '2000-01-01T00:00:00.000Z' }, { name: 'B' });
		expect(next).toMatchObject({ id: p.id, name: 'B', tags: [] });
		expect(next.updatedAt > '2000').toBe(true);
	});
});
