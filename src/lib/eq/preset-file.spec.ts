import { describe, expect, it } from 'vitest';
import type { PeqPreset } from './model';
import { createPreset, importPreset, parsePreset, PresetError, presetJson } from './preset-file';

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
		{ type: 'LSQ', freq: 105, gain: 4, q: 0.7, enabled: true },
		{ type: 'NOTCH', freq: 50, gain: 0, q: 30, enabled: false },
		{ type: 'HPF', freq: 20, gain: 0, q: 0.707, enabled: true },
		{ type: 'CQ', freq: 3000, gain: -2, q: 2, enabled: true }
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
		const { preset, disabled } = parsePreset(V1);
		expect(preset.schemaVersion).toBe(2);
		expect(preset.filters.map((f) => f.type)).toEqual(['LSC', 'NO', 'HPQ', 'PK']);
		expect(preset.filters[1].enabled).toBe(false);
		expect(preset).toMatchObject({
			id: 'old',
			name: 'Prototype preset',
			tags: ['bass'],
			pregain: -4,
			createdAt: V1.createdAt,
			source: V1.source
		});
		expect(disabled).toBe(1);
	});

	it('keeps a v1 band with no v2 type, disabled, at its own values', () => {
		const { preset } = parsePreset(V1);
		expect(preset.filters[3]).toEqual({
			type: 'PK',
			freq: 3000,
			q: 2,
			gain: -2,
			enabled: false
		});
	});

	it('reads a v2 preset back as it was written', () => {
		const v2 = parsePreset(V1).preset;
		expect(parsePreset(JSON.parse(presetJson(v2)))).toEqual({ preset: v2, disabled: 0 });
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
		expect(preset.filters[0].enabled).toBe(true);
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
		const filters = [{ type: 'PK' as const, freq: 1000, q: 1, gain: 3, enabled: true }];
		const preset = createPreset({ name: 'Mine', filters, pregain: 'auto', deviceId: 'fiio-ka17' });
		expect(preset.filters).toEqual(filters);
		expect(preset.filters[0]).not.toBe(filters[0]);
		expect(preset.source).toEqual({ deviceId: 'fiio-ka17', app: 'uniPEQ', appVersion: '0.0.1' });
		expect(preset.createdAt).toBe(preset.updatedAt);
	});
});

describe('importPreset', () => {
	it('imports preset JSON under a fresh id', () => {
		const { preset, disabled } = importPreset(JSON.stringify(V1), 'old.json');
		expect(preset.id).not.toBe('old');
		expect(preset.name).toBe('Prototype preset');
		expect(disabled).toBe(1);
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
			filters: [{ type: 'HSC', freq: 8000, q: 0.7, gain: -2, enabled: true }],
			pregain: -1
		});
		const { preset } = importPreset(presetJson(original), 'Round.json');
		expect({ ...preset, id: original.id }).toEqual(original);
	});
});
