import { describe, expect, it } from 'vitest';
import { TABS, activeTab } from './tabs';

describe('activeTab', () => {
	it('matches tab paths, ignoring a trailing slash', () => {
		expect(activeTab('/').path).toBe('/');
		expect(activeTab('/presets').path).toBe('/presets');
		expect(activeTab('/settings/').path).toBe('/settings');
	});

	it('treats unknown paths as home', () => {
		expect(activeTab('/nowhere')).toBe(TABS[0]);
	});
});
