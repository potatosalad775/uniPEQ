import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, resolveDark } from './settings-store.svelte';

describe('parseSettings', () => {
	it('falls back to defaults for missing or broken storage', () => {
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
	});

	it('reads the Vue prototype settings, dropping its language field', () => {
		const stored = JSON.stringify({
			theme: 'dark',
			language: 'ko',
			autoPushDelayMs: 800,
			autoPushEnabled: false,
			writeWarning: true,
			verboseLogging: true
		});
		expect(parseSettings(stored)).toEqual({
			theme: 'dark',
			autoPushDelayMs: 800,
			autoPushEnabled: false,
			writeWarning: true,
			verboseLogging: true
		});
	});

	it('keeps defaults for fields of the wrong type', () => {
		const stored = JSON.stringify({
			theme: 'blue',
			autoPushDelayMs: -1,
			writeWarning: 'no',
			verboseLogging: 'yes'
		});
		expect(parseSettings(stored)).toEqual(DEFAULT_SETTINGS);
	});
});

describe('resolveDark', () => {
	it('follows the system only for the system theme', () => {
		expect(resolveDark('system', true)).toBe(true);
		expect(resolveDark('system', false)).toBe(false);
		expect(resolveDark('dark', false)).toBe(true);
		expect(resolveDark('light', true)).toBe(false);
	});
});
