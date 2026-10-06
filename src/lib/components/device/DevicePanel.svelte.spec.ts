import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceConnection, PeqCapabilities } from '$lib/device-peq/types';
import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
import { eqStore } from '$lib/stores/eq-store.svelte';
import BandTable from './BandTable.svelte';
import DevicePanel from './DevicePanel.svelte';

function ka17(): DeviceConnection & { device: { [k: string]: ReturnType<typeof vi.fn> } } {
	const capabilities: PeqCapabilities = {
		canRead: true,
		canWrite: true,
		readsPreamp: true,
		readsSlot: false,
		writesPreamp: true,
		writesSlot: false,
		readsCurrentSlot: true,
		canEnable: true,
		slots: [
			{ id: 0, name: 'Jazz' },
			{ id: 4, name: 'USER1' },
			{ id: 10, name: 'BYPASS', bypass: true }
		],
		disconnectOnSave: false,
		experimental: false
	};
	return {
		device: {
			capabilities,
			pull: vi.fn(async () => ({
				filters: [
					{ type: 'LSC', freq: 105, q: 0.7, gain: 4 },
					{ type: 'PK', freq: 3000, q: 2, gain: -3.5 },
					null
				],
				preamp: -4
			})),
			push: vi.fn(),
			currentSlot: vi.fn(),
			setEnabled: vi.fn(async () => {}),
			close: vi.fn(async () => {})
		},
		connectionType: 'hid',
		name: 'FiiO KA17',
		profile: {
			schemaVersion: '1.0',
			id: 'fiio-ka17',
			kind: 'hardware',
			device: { brand: 'FiiO', model: 'KA17' },
			bandCount: 10,
			band: { types: ['PK'], gain: { min: -12, max: 12 } },
			preamp: { mode: 'manual', gain: { min: -12, max: 0 } },
			meta: { status: 'draft', sources: [] }
		} as Profile,
		profileSource: 'device',
		profileId: 'fiio-ka17',
		identity: {}
	} as never;
}

describe('DevicePanel', () => {
	afterEach(() => devicePeqStore.setDisconnected());

	it('offers to connect a USB device when nothing is connected', async () => {
		render(DevicePanel);
		await expect.element(page.getByRole('button', { name: 'Connect USB device' })).toBeVisible();
	});

	it('shows the device, its limits and Device EQ, and reads its bands', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		render(DevicePanel);
		render(BandTable);

		await expect.element(page.getByText('FiiO KA17')).toBeVisible();
		await expect.element(page.getByText('10 bands · -12 to 12 dB')).toBeVisible();
		const deviceEq = page.getByRole('combobox', { name: 'Device EQ' });
		await expect.element(deviceEq).toHaveValue('p4');

		await page.getByRole('button', { name: "Replace the band list with the device's EQ" }).click();
		await expect.element(page.getByText('Read 2 band(s) from the device')).toBeVisible();
		expect(conn.device.pull).toHaveBeenCalledWith({});
		expect(eqStore.filters.map((f) => f.type)).toEqual(['LSC', 'PK']);
		await expect.element(page.getByText('Preamp -4 dB')).toBeVisible();
		await expect.element(page.getByText('3 kHz')).toBeVisible();
	});

	it('switches the device when Device EQ changes', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		render(DevicePanel);

		await page.getByRole('combobox', { name: 'Device EQ' }).selectOptions('Off (EQ bypassed)');
		await vi.waitFor(() => expect(conn.device.setEnabled).toHaveBeenCalledWith(false));
		expect(devicePeqStore.selection).toBe('off');
	});

	it('disconnects', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		render(DevicePanel);

		await page.getByRole('button', { name: 'Disconnect' }).click();
		await expect.element(page.getByRole('button', { name: 'Connect USB device' })).toBeVisible();
		expect(conn.device.close).toHaveBeenCalled();
	});
});
