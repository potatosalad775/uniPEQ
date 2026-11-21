import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { twoEqDevice } from '#lib/device-peq/__fixtures__/two-eq.js';
import { OWN_EQ } from '#lib/device-peq/device-eqs.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import ChannelControl from './ChannelControl.svelte';
import EqControl from './EqControl.svelte';

const eqRow = () => page.getByRole('group', { name: 'EQ' });
const channels = () => page.getByRole('group', { name: 'Channels' });
const usr = () => page.getByRole('radio', { name: 'USR EQ' });
const spk = () => page.getByRole('radio', { name: 'SPK EQ' });

/** The two-EQ device on its user EQ, as connecting leaves it, its bands read. */
async function onUserEq({ absent = [] as string[] } = {}) {
	const device = twoEqDevice({ single: absent.length > 0 });
	devicePeqStore.setConnected(device.conn, 22, true, null, OWN_EQ, absent);
	await devicePeqService.read(true);
	return device;
}

describe('EqControl', () => {
	beforeEach(() => {
		settingsStore.autoPushEnabled = false;
		settingsStore.writeWarning = false;
		eqStore.reset();
	});

	afterEach(() => {
		devicePeqService.eqLeaving = null;
		devicePeqStore.forget();
		settingsStore.autoPushEnabled = true;
		settingsStore.writeWarning = true;
	});

	it('is not there for a device with one EQ', async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 2 })), null);
		render(EqControl);
		await expect.element(page.getByText('Main EQ')).not.toBeInTheDocument();
		await expect.element(eqRow()).not.toBeInTheDocument();
	});

	it("offers each EQ by the data's name, the profile's own picked", async () => {
		await onUserEq();
		render(EqControl);
		await expect.element(usr()).toBeChecked();
		await expect.element(spk()).not.toBeChecked();
		await expect.element(spk()).toBeEnabled();
	});

	it('switches EQ, and the channels row follows the EQ', async () => {
		await onUserEq();
		render(EqControl);
		render(ChannelControl);
		await expect.element(channels()).not.toBeInTheDocument();

		await spk().click();
		await expect.element(spk()).toBeChecked();
		await expect.element(channels()).toBeVisible();
		expect(devicePeqStore.eq).toBe('spk');

		await usr().click();
		await expect.element(usr()).toBeChecked();
		await expect.element(channels()).not.toBeInTheDocument();
	});

	it("can't pick an EQ the device's mode lacks, and says why", async () => {
		await onUserEq({ absent: ['spk'] });
		render(EqControl);
		await expect.element(spk()).toBeDisabled();
		await expect.element(usr()).toBeEnabled();
		await expect
			.element(page.getByText("Not available in the device's current mode: SPK EQ"))
			.toBeVisible();
	});

	it('holds still while a device operation runs', async () => {
		await onUserEq();
		render(EqControl);
		devicePeqStore.isReading = true;
		await expect.element(spk()).toBeDisabled();
		devicePeqStore.isReading = false;
		await expect.element(spk()).toBeEnabled();
	});

	describe('with changes the EQ on screen never got', () => {
		const dialog = () => page.getByRole('dialog', { name: 'Write the changes to USR EQ first?' });

		it('asks; Cancel stays, Discard switches without them', async () => {
			const { state } = await onUserEq();
			render(EqControl);
			eqStore.update(0, { gain: 6 });

			await spk().click();
			await expect.element(dialog()).toBeVisible();
			await page.getByRole('button', { name: 'Cancel' }).click();
			await expect.element(dialog()).not.toBeInTheDocument();
			await expect.element(usr()).toBeChecked();
			expect(eqStore.filters[0].gain).toBe(6);

			await spk().click();
			await page.getByRole('button', { name: 'Discard' }).click();
			await expect.element(spk()).toBeChecked();
			expect(state.usr.filters[0].gain).toBe(2);
			expect(eqStore.channels.left.filters).toEqual(state.spk.left);
		});

		it('Write writes them to the EQ being left, then switches', async () => {
			const { state, calls } = await onUserEq();
			render(EqControl);
			eqStore.update(0, { gain: 6 });

			await spk().click();
			await page.getByRole('button', { name: 'Write' }).click();
			await expect.element(spk()).toBeChecked();
			expect(state.usr.filters[0].gain).toBe(6);
			expect(calls.filter((c) => c.op === 'push')).toEqual([{ op: 'push', eq: undefined }]);
		});
	});
});
