import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PushDialog from '#lib/components/device/PushDialog.svelte';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import type { PushPlan } from '#lib/device-peq/push-plan.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import ChannelControl from './ChannelControl.svelte';
import EqGraph from './EqGraph.svelte';

const pk = (gain: number) => ({ type: 'PK' as const, freq: 1000, q: 1, gain });
const STEREO = { ...hardwareProfile('dx5', { bandCount: 2 }), channels: 'independent' as const };

const channels = () => page.getByRole('radiogroup', { name: 'Channels' });

describe('ChannelControl', () => {
	beforeEach(() => {
		eqStore.reset();
		eqStore.open({ filters: [pk(3), pk(-2)], preamp: -3 });
	});
	afterEach(() => devicePeqStore.forget());

	it('is not there for a device with one EQ for both channels', async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 2 })), null);
		render(ChannelControl);
		await expect.element(channels()).not.toBeInTheDocument();
	});

	it('sets the channels apart and links them again', async () => {
		devicePeqStore.setConnected(fakeConnection(STEREO, { perChannel: true }), null);
		render(ChannelControl);
		await expect.element(page.getByRole('radio', { name: 'L+R' })).toBeChecked();

		await page.getByRole('radio', { name: 'R' }).click();
		expect(eqStore.editing).toBe('right');
		await expect.element(page.getByText(/faint curve is the left/)).toBeVisible();

		await page.getByRole('radio', { name: 'L+R' }).click();
		expect(eqStore.linked).toBe(true);
	});

	it('draws the other channel’s curve while they are apart', async () => {
		devicePeqStore.setConnected(fakeConnection(STEREO, { perChannel: true }), null);
		render(EqGraph);
		const curves = () => document.querySelectorAll('svg path.fill-none').length;
		await expect.poll(curves).toBe(1);
		eqStore.edit('right');
		eqStore.update(0, { gain: 6 });
		await expect.poll(curves).toBe(2);
	});

	it('stays in sight, read-only, while the channels are apart and the device is away', async () => {
		devicePeqStore.setConnected(fakeConnection(STEREO, { perChannel: true }), null);
		eqStore.edit('right');
		devicePeqStore.setDisconnected();
		render(ChannelControl);
		await expect.element(page.getByRole('radio', { name: 'R' })).toBeChecked();
		await expect.element(page.getByRole('radio', { name: 'L+R' })).toBeDisabled();
	});
});

describe('PushDialog', () => {
	it('names the channel of each change when the channels are written apart', async () => {
		const plan: PushPlan = {
			filters: [],
			emptySlots: 0,
			right: { filters: [], emptySlots: 0 },
			changes: [{ kind: 'preamp', wanted: -14, written: -12, channel: 'right' }],
			clipRisk: false,
			infeasible: false
		};
		render(PushDialog, { open: true, plan, deviceName: 'Topping DX5 II', onConfirm: () => {} });
		await expect.element(page.getByText('Right: Preamp: -14 dB → -12 dB')).toBeVisible();
	});
});
