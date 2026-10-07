import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { fakeConnection } from '$lib/device-peq/__fixtures__/connection';
import { graphicProfile, hardwareProfile } from '$lib/eq/__fixtures__/profiles';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import BandEditor from './BandEditor.svelte';

describe('BandEditor', () => {
	beforeEach(() => {
		eqStore.reset();
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3, enabled: true }], 0);
	});

	afterEach(() => devicePeqStore.setDisconnected());

	it("offers the slot's types and switches the band's", async () => {
		render(BandEditor, { index: 0 });
		const group = page.getByRole('group', { name: 'Type' });
		await expect.element(group.getByRole('radio', { name: 'PK' })).toBeChecked();
		await expect.element(group.getByRole('radio', { name: 'LPQ' })).not.toBeInTheDocument();
		await group.getByRole('radio', { name: 'LSC' }).click();
		expect(eqStore.filters[0].type).toBe('LSC');
	});

	it("puts a typed value onto the slot's range", async () => {
		render(BandEditor, { index: 0 });
		const gain = page.getByRole('spinbutton', { name: 'Gain' });
		await gain.fill('40');
		await userEvent.keyboard('{Enter}');
		expect(eqStore.filters[0].gain).toBe(12);
		await expect.element(gain).toHaveValue(12);
		await expect.element(page.getByText('Allowed: -12 – 12 dB, step 0.1')).toBeVisible();
	});

	it('steps with the arrow keys, and Escape takes the steps back', async () => {
		render(BandEditor, { index: 0 });
		const freq = page.getByRole('spinbutton', { name: 'Frequency' });
		await freq.click();
		await userEvent.keyboard('{ArrowUp}{ArrowUp}');
		expect(eqStore.filters[0].freq).toBe(1059);
		await userEvent.keyboard('{Escape}');
		expect(eqStore.filters[0].freq).toBe(1000);
	});

	it("flags a value the device won't take, without changing it", async () => {
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 15, enabled: true }], 0);
		render(BandEditor, { index: 0 });
		await expect
			.element(page.getByRole('spinbutton', { name: 'Gain' }))
			.toHaveAttribute('aria-invalid', 'true');
		await expect.element(page.getByText(/The device won't take this/)).toBeVisible();
		expect(eqStore.filters[0].gain).toBe(15);
	});

	it("shows a graphic EQ's fixed frequency read-only, with no type choice and no Remove", async () => {
		const profile = graphicProfile('geq', [
			{ freq: 125, q: 1.41 },
			{ freq: 1000, q: 1.41 }
		]);
		devicePeqStore.setConnected(fakeConnection(profile), null);
		eqStore.replace(
			[
				{ type: 'PK', freq: 125, q: 1.41, gain: 2, enabled: true },
				{ type: 'PK', freq: 1000, q: 1.41, gain: 0, enabled: true }
			],
			0
		);
		render(BandEditor, { index: 0 });
		await expect.element(page.getByRole('spinbutton', { name: 'Gain' })).toBeVisible();
		await expect
			.element(page.getByRole('spinbutton', { name: 'Frequency' }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText('125 Hz', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('group', { name: 'Type' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /Remove band/ })).not.toBeInTheDocument();
	});

	it('hides gain for a type that has none', async () => {
		devicePeqStore.setDisconnected();
		eqStore.replace([{ type: 'HPQ', freq: 80, q: 0.7, gain: 0, enabled: true }], 0);
		render(BandEditor, { index: 0 });
		await expect.element(page.getByText('This filter type has no gain.')).toBeVisible();
		await expect.element(page.getByRole('spinbutton', { name: 'Gain' })).not.toBeInTheDocument();
	});
});
