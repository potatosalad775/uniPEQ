import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import * as m from '#lib/paraglide/messages.js';
import BandList from './BandList.svelte';

const SLOTS = [
	{ id: 0, name: 'JAZZ' },
	{ id: 7, name: 'Custom1', writable: true }
];

/** A 32-band device on `slot`, the list holding 8 bands (as a built-in preset reads). */
function onSlot(slot: number) {
	const conn = fakeConnection(hardwareProfile('ds3', { bandCount: 32 }), {
		readsSlot: true,
		writesSlot: true,
		slots: SLOTS
	});
	devicePeqStore.setConnected(conn, slot);
	const band = { type: 'PK' as const, freq: 1000, q: 1, gain: 0 };
	eqStore.replace(Array.from({ length: 8 }, () => ({ ...band })));
	render(BandList);
}

describe('BandList', () => {
	beforeEach(() => eqStore.reset());
	afterEach(() => devicePeqStore.forget());

	it('offers Fit for a list shorter than a user preset', async () => {
		onSlot(7);
		await expect.element(page.getByText(/24 band\(s\) fewer/)).toBeVisible();
		await expect.element(page.getByRole('button', { name: m.eq_fit_title() })).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^1/ })).toBeEnabled();
	});

	it('keeps a built-in preset read-only, with no Fit', async () => {
		onSlot(0);
		await expect.element(page.getByText(/built-in presets, so it can't be edited/)).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^1/ })).toBeDisabled();
		await expect.element(page.getByText(/fewer/)).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: m.eq_fit_title() }))
			.not.toBeInTheDocument();
	});
});
