import { describe, expect, it } from 'vitest';
import { toAndroidValue, valuesDir } from './android-strings.js';

describe('toAndroidValue', () => {
	it('maps inputs to positional placeholders in getString() order, wherever they sit', () => {
		expect(toAndroidValue('link_notification_device', '{device} · {host}')).toBe('%2$s · %1$s');
	});

	it('escapes what aapt would otherwise read', () => {
		expect(toAndroidValue('link_unlink', `It's "<b>" & \\`)).toBe(
			`It\\'s \\"&lt;b&gt;\\" &amp; \\\\`
		);
		expect(toAndroidValue('link_unlink', '@home')).toBe('\\@home');
	});

	it('doubles % only in strings that are formatted', () => {
		expect(toAndroidValue('link_unlink', '100%')).toBe('100%');
		expect(toAndroidValue('link_notification', '{host} 100%')).toBe('%1$s 100%%');
	});

	it('rejects inputs Java does not pass, and plurals', () => {
		expect(() => toAndroidValue('link_notification', '{name}')).toThrow('{name}');
		expect(() => toAndroidValue('link_unlink', [{ match: {} }])).toThrow('plurals');
	});
});

describe('valuesDir', () => {
	it('names the res/ folder Android resolves for a locale', () => {
		expect(valuesDir('en')).toBe('values');
		expect(valuesDir('ko')).toBe('values-ko');
		expect(valuesDir('pt-BR')).toBe('values-b+pt+BR');
	});
});
