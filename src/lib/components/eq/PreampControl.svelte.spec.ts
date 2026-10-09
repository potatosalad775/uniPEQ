import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { UNCONSTRAINED } from '$lib/eq/eq-constraint';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import PreampControl from './PreampControl.svelte';

describe('PreampControl', () => {
	beforeEach(() => {
		eqStore.reset();
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 6 }], -6);
	});

	afterEach(() => devicePeqStore.forget());

	it("is a row that opens a slider over a manual preamp's range, with Auto", async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		render(PreampControl);
		const row = page.getByRole('button', { name: /^Preamp/ });
		await expect.poll(() => row.element().textContent).toContain('-6 dB');
		await row.click();

		const sheet = page.getByRole('dialog', { name: 'Preamp' });
		const slider = sheet.getByRole('slider', { name: 'Preamp' });
		await expect.element(slider).toBeVisible();
		await sheet.getByRole('button', { name: 'Raise Preamp' }).click();
		// One step of the device's 0.5 dB grid.
		expect(eqStore.preamp).toBe(-5.5);

		await sheet.getByRole('switch').click();
		expect(eqStore.autoPreamp).toBe(true);
		// Auto follows the bands: the slider steps aside until Auto is off again.
		await expect.element(slider).not.toBeInTheDocument();
		await expect.poll(() => row.element().textContent).toContain('Auto');
	});

	it('opens under its row with inlineEditor', async () => {
		devicePeqStore.setConnected(fakeConnection(UNCONSTRAINED), null);
		render(PreampControl, { inlineEditor: true });
		const row = page.getByRole('button', { name: /^Preamp/ });
		await row.click();
		await expect.element(row).toHaveAttribute('aria-expanded', 'true');
		await expect.element(page.getByRole('slider', { name: 'Preamp' })).toBeVisible();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('is read-only while the device is disconnected', async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		devicePeqStore.setDisconnected();
		render(PreampControl);
		await expect.element(page.getByRole('button', { name: /^Preamp/ })).toBeDisabled();
	});

	it('warns when the preamp leaves too little room for the boost', async () => {
		eqStore.setPreamp(-2);
		render(PreampControl);
		await expect.element(page.getByRole('img', { name: /it may clip/ })).toBeVisible();
	});

	it('shows nothing where the device sets its own preamp', async () => {
		const profile = hardwareProfile('dac', { bandCount: 4, preamp: { mode: 'auto' } });
		devicePeqStore.setConnected(fakeConnection(profile), null);
		render(PreampControl);
		await expect.element(page.getByRole('button', { name: /^Preamp/ })).not.toBeInTheDocument();
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
