import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { eqStore } from '$lib/stores/eq-store.svelte';
import { presetStore } from '$lib/stores/preset-store.svelte';
import PresetsPanel from './PresetsPanel.svelte';

function clearPresets() {
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith('unipeq.preset')) localStorage.removeItem(key);
	}
}

describe('PresetsPanel', () => {
	beforeEach(async () => {
		clearPresets();
		await presetStore.refresh();
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3, enabled: true }], -3);
	});

	afterEach(clearPresets);

	it('saves the EQ, then loads it back after it changed', async () => {
		render(PresetsPanel);
		await page.getByRole('textbox', { name: 'Save the current EQ as' }).fill('Bright');
		await page.getByRole('button', { name: 'Save the current EQ as a preset' }).click();
		await expect.element(page.getByText('Saved “Bright”.')).toBeVisible();

		eqStore.replace([], 0);
		await page.getByRole('button', { name: 'Load Bright into the EQ' }).click();
		await expect.element(page.getByText('Loaded “Bright” into the EQ.')).toBeVisible();
		expect(eqStore.filters).toHaveLength(1);
		expect(eqStore.preamp).toBe(-3);
	});

	it('deletes only on the second press', async () => {
		await presetStore.saveCurrent('Doomed');
		render(PresetsPanel);

		await page.getByRole('button', { name: 'Delete Doomed' }).click();
		expect(presetStore.index).toHaveLength(1);
		await page.getByRole('button', { name: 'Press again to delete Doomed for good' }).click();
		await expect.element(page.getByText('Deleted “Doomed”.')).toBeVisible();
		expect(presetStore.index).toHaveLength(0);
	});

	it('says why an unreadable stored preset did not load', async () => {
		localStorage.setItem(
			'unipeq.presets.index',
			JSON.stringify([{ id: 'bad', name: 'Broken', tags: [], updatedAt: '2026-01-01' }])
		);
		localStorage.setItem('unipeq.preset.bad', JSON.stringify({ schemaVersion: 7 }));
		await presetStore.refresh();
		render(PresetsPanel);

		await page.getByRole('button', { name: 'Load Broken into the EQ' }).click();
		await expect
			.element(page.getByText('This preset was made by a newer version of uniPEQ.'))
			.toBeVisible();
	});
});
