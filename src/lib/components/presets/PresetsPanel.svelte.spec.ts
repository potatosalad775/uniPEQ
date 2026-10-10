import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
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
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3 }], -3);
	});

	afterEach(() => {
		clearPresets();
		devicePeqStore.forget();
	});

	it('loads a preset only once a device is known', async () => {
		await presetStore.saveCurrent('Bright');
		render(PresetsPanel);
		const load = page.getByRole('button', { name: 'Connect a device to load a preset' });
		await expect.element(load).toBeDisabled();
	});

	it('saves the EQ, then loads it back after it changed', async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 1 })), null);
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

	it('deletes only once confirmed', async () => {
		await presetStore.saveCurrent('Doomed');
		render(PresetsPanel);

		await page.getByRole('button', { name: 'More actions for Doomed' }).click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		expect(presetStore.index).toHaveLength(1);
		await page.getByRole('button', { name: 'Delete Doomed for good' }).click();
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
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 1 })), null);
		render(PresetsPanel);

		await page.getByRole('button', { name: 'Load Broken into the EQ' }).click();
		await expect
			.element(page.getByText('This preset was made by a newer version of uniPEQ.'))
			.toBeVisible();
	});

	it('finds presets by name or tag', async () => {
		await presetStore.saveCurrent('Bass boost', ['warm']);
		await presetStore.saveCurrent('Vocal', ['IEM']);
		render(PresetsPanel);

		await page.getByRole('searchbox', { name: 'Search names and tags' }).fill('iem');
		await expect.element(page.getByText('Vocal')).toBeVisible();
		await expect.element(page.getByText('Bass boost')).not.toBeInTheDocument();
		await page.getByRole('searchbox', { name: 'Search names and tags' }).fill('nothing');
		await expect.element(page.getByText('No preset matches.')).toBeVisible();
	});

	it('renames and retags a preset', async () => {
		await presetStore.saveCurrent('Old name');
		render(PresetsPanel);

		await page.getByRole('button', { name: 'More actions for Old name' }).click();
		await page.getByRole('menuitem', { name: 'Rename and tags…' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('textbox', { name: 'Name' }).fill('New name');
		await dialog.getByRole('textbox', { name: 'Tags' }).fill('a, b');
		await dialog.getByRole('button', { name: 'Save' }).click();

		await expect.element(page.getByText('Saved “New name”.')).toBeVisible();
		expect(presetStore.index).toEqual([
			expect.objectContaining({ name: 'New name', tags: ['a', 'b'] })
		]);
	});

	it('duplicates a preset', async () => {
		await presetStore.saveCurrent('Base');
		render(PresetsPanel);

		await page.getByRole('button', { name: 'More actions for Base' }).click();
		await page.getByRole('menuitem', { name: 'Duplicate' }).click();
		await expect.element(page.getByText('Saved a copy as “Base (copy)”.')).toBeVisible();
		expect(presetStore.index).toHaveLength(2);
	});

	it('says how each preset fits the connected device', async () => {
		await presetStore.saveCurrent('Peaks');
		eqStore.replace([{ type: 'NO', freq: 1000, q: 1, gain: 0 }], 0);
		await presetStore.saveCurrent('Notch');
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		render(PresetsPanel);

		await expect.element(page.getByText('Compatible', { exact: true })).toBeVisible();
		await expect.element(page.getByText('1 adjustment(s)')).toBeVisible();
	});
});
