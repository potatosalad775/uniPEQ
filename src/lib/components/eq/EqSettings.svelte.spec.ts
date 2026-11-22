import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DeviceControls from '#lib/components/device/DeviceControls.svelte';
import SyncBar from '#lib/components/device/SyncBar.svelte';
import { twoEqDevice } from '#lib/device-peq/__fixtures__/two-eq.js';
import { OWN_EQ } from '#lib/device-peq/device-eqs.js';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import EqControl from './EqControl.svelte';
import EqSettings from './EqSettings.svelte';

const headroom = () => page.getByRole('group', { name: 'Headroom' });
const step = (name: string) => headroom().getByRole('radio', { name, exact: true });
const crossfeed = () => page.getByRole('slider', { name: 'Crossfeed' });

/**
 * The two-EQ device on its user EQ, as connecting leaves it: its controls and its bands read. Its
 * user EQ holds a headroom of -6 dB and a crossfeed of 20, its headphone EQ a headroom of 0 dB.
 */
async function onUserEq() {
	const device = twoEqDevice();
	devicePeqStore.setConnected(device.conn, 22, true, null, OWN_EQ, []);
	devicePeqStore.controlValues = await device.conn.device.readControls();
	await devicePeqService.read(true);
	// Whichever EQ is on screen, a control is written through the device.
	const writes: [id: string, value: number][] = [];
	for (const eq of [undefined, 'spk']) {
		const view = device.conn.device.eq(eq);
		const write = view.writeControl.bind(view);
		view.writeControl = (id, value) => (writes.push([id, value]), write(id, value));
	}
	return { ...device, writes };
}

/** Drag a slider to `value` and let go. */
function slide(value: number) {
	const input = crossfeed().element() as HTMLInputElement;
	input.value = String(value);
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('EqSettings', () => {
	beforeEach(() => {
		settingsStore.autoPushEnabled = false;
		settingsStore.writeWarning = false;
		eqStore.reset();
	});

	afterEach(() => {
		devicePeqStore.forget();
		settingsStore.autoPushEnabled = true;
		settingsStore.writeWarning = true;
	});

	it("shows the profile's own EQ its headroom and crossfeed, as the device holds them", async () => {
		await onUserEq();
		render(EqSettings);
		await expect.element(step('-6')).toBeChecked();
		await expect.element(step('0')).not.toBeChecked();
		await expect.element(step('-12')).not.toBeChecked();
		await expect.element(crossfeed()).toHaveValue('20');
		// One headroom: the other EQ's is not on the card.
		expect(page.getByRole('group', { name: 'Headroom' }).elements()).toHaveLength(1);
		await expect.element(page.getByText('SPK EQ HEADROOM')).not.toBeInTheDocument();
	});

	it("shows the other EQ's own once it is picked, and not the first one's", async () => {
		await onUserEq();
		render(EqControl);
		render(EqSettings);
		await page.getByRole('radio', { name: 'SPK EQ' }).click();
		await expect.element(step('0')).toBeChecked();
		await expect.element(step('-6')).not.toBeChecked();
		await expect.element(crossfeed()).not.toBeInTheDocument();

		await page.getByRole('radio', { name: 'USR EQ' }).click();
		await expect.element(step('-6')).toBeChecked();
		await expect.element(crossfeed()).toBeVisible();
	});

	it("leaves them out of the device panel, which keeps the device's own", async () => {
		await onUserEq();
		render(DeviceControls);
		await expect.element(page.getByRole('button', { name: /^DAC filter/ })).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^Output gain/ })).toBeVisible();
		await expect.element(page.getByText('Headroom')).not.toBeInTheDocument();
		await expect.element(page.getByText('Crossfeed')).not.toBeInTheDocument();
		await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
	});

	it("is not there for a control the device doesn't have now", async () => {
		const { conn, state } = await onUserEq();
		await devicePeqService.selectEq('spk');
		render(EqSettings);
		await expect.element(headroom()).toBeVisible();

		// The device left the mode that has the headphone EQ: its headroom reads null.
		state.single = true;
		devicePeqStore.controlValues = await conn.device.readControls();
		await expect.element(headroom()).not.toBeInTheDocument();
	});

	it('is off while its EQ is switched off, and back with it', async () => {
		await onUserEq();
		render(EqSettings);
		await expect.element(step('-12')).toBeEnabled();

		await devicePeqService.switchTo('off');
		await expect.element(step('-12')).toBeDisabled();
		await expect.element(step('-6')).toBeChecked();
		await expect.element(crossfeed()).toBeDisabled();

		await devicePeqService.switchTo('on');
		await expect.element(step('-12')).toBeEnabled();
		await expect.element(crossfeed()).toBeEnabled();
	});

	it('holds still while a device operation runs', async () => {
		await onUserEq();
		render(EqSettings);
		devicePeqStore.operation = 'write';
		await expect.element(step('0')).toBeDisabled();
		devicePeqStore.operation = null;
		await expect.element(step('0')).toBeEnabled();
	});

	it('writes a change at once under its own id, and the list has no edit for it', async () => {
		const { state, writes, calls } = await onUserEq();
		render(EqControl);
		render(EqSettings);
		render(SyncBar);
		calls.length = 0;

		await step('-12').click();
		await expect.element(step('-12')).toBeChecked();
		expect(writes).toEqual([['headroom', -12]]);
		expect(state.controls.headroom).toBe(-12);
		await expect.element(page.getByRole('status')).toHaveTextContent('Set Headroom to -12 dB.');

		slide(30);
		await vi.waitFor(() =>
			expect(writes).toEqual([
				['headroom', -12],
				['crossfeed', 30]
			])
		);
		await expect.element(crossfeed()).toHaveValue('30');

		// Nothing for Write to send, nothing to undo, and no write went out.
		expect(devicePeqStore.inSync).toBe(true);
		expect(devicePeqStore.hasUnwritten).toBe(false);
		expect(eqStore.canUndo).toBe(false);
		expect(calls.filter((c) => c.op === 'push')).toEqual([]);

		// The other EQ's headroom is another control.
		await page.getByRole('radio', { name: 'SPK EQ' }).click();
		await expect.element(step('0')).toBeChecked();
		await step('-6').click();
		await expect.element(step('-6')).toBeChecked();
		expect(writes.at(-1)).toEqual(['headroomSpk', -6]);
		expect(state.controls).toMatchObject({ headroom: -12, headroomSpk: -6 });
		expect(devicePeqStore.hasUnwritten).toBe(false);
	});

	it('leaves an edit waiting to be written as it was', async () => {
		await onUserEq();
		render(EqSettings);
		eqStore.update(0, { gain: 6 });
		await step('0').click();
		await expect.element(step('0')).toBeChecked();
		expect(eqStore.filters[0].gain).toBe(6);
		expect(devicePeqStore.hasUnwritten).toBe(true);
	});

	it('says when the device refuses a change, and shows what it holds', async () => {
		const { state } = await onUserEq();
		render(EqSettings);
		render(SyncBar);
		// Switched off in the device's own app, behind this one.
		state.enabled.usr = false;
		await step('0').click();
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('The device refused the request.');
		expect(devicePeqStore.failure).toEqual({ op: 'control', code: 'rejected' });
		await expect.element(step('-6')).toBeChecked();
	});

	it('follows a preset that holds its own', async () => {
		await onUserEq();
		render(EqSettings);
		await expect.element(crossfeed()).toHaveValue('20');
		// Custom #2 was saved with a crossfeed of 35.
		await devicePeqService.switchTo('p23');
		await expect.element(crossfeed()).toHaveValue('35');
	});
});
