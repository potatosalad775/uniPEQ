import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import PreampControl from './PreampControl.svelte';

describe('PreampControl', () => {
	beforeEach(() => {
		eqStore.reset();
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 6, enabled: true }], -6);
	});

	afterEach(() => devicePeqStore.setDisconnected());

	it("is a slider over a manual preamp's range, with Auto", async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		render(PreampControl);
		const slider = page.getByRole('slider', { name: 'Preamp' });
		await expect.element(slider).toHaveAttribute('min', '-12');
		await expect.element(slider).toHaveAttribute('max', '0');

		await page.getByRole('switch', { name: 'Auto' }).click();
		expect(eqStore.autoPreamp).toBe(true);
		await expect.element(slider).toBeDisabled();
	});

	it('warns when the preamp leaves too little room for the boost', async () => {
		eqStore.setPreamp(-2);
		render(PreampControl);
		await expect.element(page.getByText(/it may clip/)).toBeVisible();
	});

	it('shows nothing where the device sets its own preamp', async () => {
		const profile = hardwareProfile('dac', { bandCount: 4, preamp: { mode: 'auto' } });
		devicePeqStore.setConnected(fakeConnection(profile), null);
		render(PreampControl);
		await expect.element(page.getByRole('slider', { name: 'Preamp' })).not.toBeInTheDocument();
		await expect.element(page.getByText(/no preamp/)).not.toBeInTheDocument();
	});

	it('warns about a boost on a device with no preamp', async () => {
		const profile = hardwareProfile('dac', { bandCount: 4, preamp: { mode: 'none' } });
		devicePeqStore.setConnected(fakeConnection(profile), null);
		render(PreampControl);
		await expect
			.element(page.getByText(/This device has no preamp, and the EQ boosts by up to 6/))
			.toBeVisible();
	});
});
