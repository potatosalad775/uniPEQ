import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Control } from '@potatosalad775/eqcaps-core';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { ds3Connection } from '#lib/device-peq/__fixtures__/ds3.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import DeviceControls from './DeviceControls.svelte';
import SyncBar from './SyncBar.svelte';

/** A DS3 connected and its controls read, as connecting leaves it. */
async function connected(values?: Record<string, number>) {
	const ds3 = ds3Connection(values);
	devicePeqStore.setConnected(ds3.conn, 7, true);
	devicePeqStore.controlValues = await ds3.conn.device.readControls();
	const write = vi.spyOn(ds3.conn.device, 'writeControl');
	render(DeviceControls);
	return { ...ds3, write };
}

describe('DeviceControls', () => {
	beforeEach(() => devicePeqStore.forget());
	afterEach(() => devicePeqStore.forget());

	it('shows the controls the device has now, under their roles', async () => {
		await connected();
		await expect.element(page.getByRole('heading', { name: 'Device settings' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^USB mode.*UAC 2\.0/ })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /^DAC filter.*Fast Linear/ }))
			.toBeVisible();
		await expect.element(page.getByRole('switch', { name: 'Upsampling' })).toBeVisible();
		await expect.element(page.getByRole('slider', { name: 'Volume' })).toHaveValue('24');
		await expect.element(page.getByRole('switch', { name: 'Light' })).toBeChecked();
		await expect.element(page.getByText('Sound mode')).not.toBeInTheDocument();
	});

	it('shows nothing for a device without controls', async () => {
		devicePeqStore.setConnected(ds3Connection().conn, 7, true);
		render(DeviceControls);
		await expect.element(page.getByText('Device settings')).not.toBeInTheDocument();
	});

	it('writes a switch and a choice when changed', async () => {
		const { write } = await connected();
		await page.getByRole('switch', { name: 'Light' }).click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('led', 0));
		await expect.element(page.getByRole('switch', { name: 'Light' })).not.toBeChecked();

		await page.getByRole('button', { name: /^DAC filter/ }).click();
		await page.getByRole('menuitemradio', { name: 'Apodizing' }).click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('filterMode', 1));
		await expect
			.element(page.getByRole('button', { name: /^DAC filter.*Apodizing/ }))
			.toBeVisible();
	});

	it('writes the volume once the slider is let go', async () => {
		const { write } = await connected();
		const slider = page.getByRole('slider', { name: 'Volume' });
		const input = slider.element() as HTMLInputElement;
		input.value = '30';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await expect.element(page.getByText('30', { exact: true })).toBeVisible();
		expect(write).not.toHaveBeenCalled();
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('volume', 30));
		expect(write).toHaveBeenCalledOnce();
	});

	it('asks before a change that restarts the device', async () => {
		const { conn, write } = await connected();
		conn.reopen = vi.fn(async () => null);
		const usbMode = page.getByRole('button', { name: /^USB mode/ });
		await expect.element(page.getByText('Changing this restarts the device.')).toBeVisible();

		await usbMode.click();
		await page.getByRole('menuitemradio', { name: 'UAC 1.0' }).click();
		const dialog = page.getByRole('dialog', { name: 'Change USB mode?' });
		await expect.element(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(write).not.toHaveBeenCalled();

		await usbMode.click();
		await page.getByRole('menuitemradio', { name: 'UAC 1.0' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Change' }).click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledWith('uacMode', 1));
	});

	it('says under the control, and in the sync bar, when the EQ stops applying', async () => {
		await connected({ uacMode: 0, filterMode: 0, upsample: 1, volume: 20, led: 0 });
		render(SyncBar);
		await expect
			.element(page.getByText("The device doesn't apply its EQ with this setting."))
			.toBeVisible();
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent("The device doesn't apply its EQ with this Upsampling setting.");
		expect(devicePeqService.sync?.tone).toBe('warning');
	});

	it('shows a gain per channel as one balance, and writes both gains for it', async () => {
		const gain = (id: string, role: Control['role']): Control => ({
			id,
			name: id,
			kind: 'range',
			role,
			range: { min: -50, max: 0, step: 1 },
			unit: 'dB'
		});
		const conn = fakeConnection(hardwareProfile('nicehck-pureaural', { bandCount: 10 }), {
			controls: [gain('leftGain', 'balance-left'), gain('rightGain', 'balance-right')]
		});
		const state: Record<string, number> = { leftGain: -4, rightGain: 0 };
		Object.assign(conn.device, {
			readControls: async () => ({ ...state }),
			writeControl: async (id: string, value: number) => {
				state[id] = value;
				return { reconnect: false };
			}
		});
		const write = vi.spyOn(conn.device, 'writeControl');
		devicePeqStore.setConnected(conn, 10, true);
		devicePeqStore.controlValues = await conn.device.readControls();
		render(DeviceControls);

		const slider = page.getByRole('slider', { name: 'Balance' });
		await expect.element(slider).toHaveValue('4');
		await expect.element(page.getByText('Left -4 dB')).toBeVisible();
		expect(page.getByRole('slider').elements()).toHaveLength(1);

		const input = slider.element() as HTMLInputElement;
		input.value = '-6';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(state).toEqual({ leftGain: 0, rightGain: -6 }));
		expect(write.mock.calls).toEqual([
			['rightGain', -6],
			['leftGain', 0]
		]);
		await expect.element(page.getByText('Right -6 dB')).toBeVisible();
	});
});
