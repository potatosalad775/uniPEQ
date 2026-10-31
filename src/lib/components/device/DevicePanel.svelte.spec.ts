import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Profile } from '@potatosalad775/eqcaps-core';
import { resetDemoDac } from '#lib/device-peq/demo.js';
import type { DeviceConnection, PeqCapabilities, PeqDevice } from '#lib/device-peq/types.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { settingsStore } from '#lib/stores/settings-store.svelte.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import BandList from '#lib/components/eq/BandList.svelte';
import DevicePanel from './DevicePanel.svelte';
import ReviewDialog from './ReviewDialog.svelte';
import SyncBar from './SyncBar.svelte';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';

// The volume warning has its own specs (device-peq-service); here writes go straight out.
beforeEach(() => {
	settingsStore.writeWarning = false;
});
afterEach(() => {
	settingsStore.writeWarning = true;
});

/** The panel as the EQ tab has it: its status in the sync bar, its review in the dialog. */
function renderPanel() {
	render(DevicePanel);
	render(SyncBar);
	render(ReviewDialog);
}

function ka17(): DeviceConnection & { device: { [k: string]: ReturnType<typeof vi.fn> } } {
	const capabilities: PeqCapabilities = {
		canRead: true,
		canWrite: true,
		readsPreamp: true,
		readsSlot: false,
		writesPreamp: true,
		writesSlot: false,
		readsCurrentSlot: true,
		readsEnabled: false,
		canEnable: true,
		slots: [
			{ id: 0, name: 'Jazz' },
			{ id: 4, name: 'USER1', writable: true },
			{ id: 10, name: 'BYPASS', bypass: true }
		],
		disconnectOnSave: false,
		experimental: false,
		readsFirmware: false,
		controls: []
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
			eqEnabled: vi.fn(),
			setEnabled: vi.fn(async () => {}),
			firmware: vi.fn(async () => null),
			readControls: vi.fn(async () => ({})),
			writeControl: vi.fn(async () => ({ reconnect: false })),
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
			band: {
				types: ['PK'],
				freq: { min: 20, max: 20000 },
				q: { min: 0.1, max: 10 },
				gain: { min: -12, max: 12 }
			},
			preamp: { mode: 'manual', gain: { min: -12, max: 0 } },
			meta: { status: 'draft', sources: [] }
		} as Profile,
		profileSource: 'device',
		profileId: 'fiio-ka17',
		identity: {}
	} as never;
}

describe('DevicePanel', () => {
	afterEach(() => devicePeqStore.forget());

	it('offers to connect a USB device when nothing is connected', async () => {
		renderPanel();
		await expect.element(page.getByRole('button', { name: 'Connect USB device' })).toBeVisible();
	});

	it('shows the device, its limits and Device EQ, and reads its bands', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		renderPanel();
		render(BandList);

		await expect.element(page.getByText('FiiO KA17')).toBeVisible();
		await expect.element(page.getByText('10 bands · -12 to 12 dB')).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^Device EQ.*USER1$/ })).toBeVisible();

		await page.getByRole('button', { name: "Replace the band list with the device's EQ" }).click();
		await expect.element(page.getByText('Read 2 band(s) from the device')).toBeVisible();
		expect(conn.device.pull).toHaveBeenCalledWith({});
		expect(eqStore.filters.map((f) => f.type)).toEqual(['LSC', 'PK']);
		expect(eqStore.preamp).toBe(-4);
		await expect.element(page.getByText('3000 Hz')).toBeVisible();
	});

	it('switches the device when Device EQ changes', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		renderPanel();

		await page.getByRole('button', { name: /^Device EQ/ }).click();
		await page.getByRole('menuitemradio', { name: 'Off (EQ bypassed)' }).click();
		await vi.waitFor(() => expect(conn.device.setEnabled).toHaveBeenCalledWith(false));
		expect(devicePeqStore.selection).toBe('off');
	});

	it('disconnects', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 4);
		renderPanel();

		await page.getByRole('button', { name: 'Disconnect' }).click();
		await expect.element(page.getByRole('button', { name: 'Connect USB device' })).toBeVisible();
		expect(conn.device.close).toHaveBeenCalled();
	});

	it('says a built-in preset is not written, and keeps Write off', async () => {
		const conn = ka17();
		devicePeqStore.setConnected(conn, 0);
		renderPanel();

		await expect
			.element(page.getByRole('status').getByText(/built-in device preset/))
			.toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /built-in device preset/ }))
			.toBeDisabled();
	});
});

describe('DevicePanel writing', () => {
	/** A KA17 whose profile takes peaks only, so a shelf needs a review. */
	function peaksOnly() {
		const conn = ka17();
		conn.profile = hardwareProfile('fiio-ka17', {
			bandCount: 10,
			band: {
				types: ['PK'],
				freq: { min: 20, max: 20000, step: 1 },
				q: { min: 0.1, max: 10, step: 0.01 },
				gain: { min: -12, max: 12, step: 0.1 }
			}
		});
		const push = vi.fn<PeqDevice['push']>(async () => ({ reconnect: false }));
		conn.device.push = push;
		return { conn, push };
	}

	beforeEach(() => {
		settingsStore.autoPushEnabled = false;
	});

	afterEach(() => {
		devicePeqStore.forget();
		settingsStore.autoPushEnabled = true;
	});

	it('writes straight away when the device holds the list exactly', async () => {
		const { conn, push } = peaksOnly();
		devicePeqStore.setConnected(conn, 4);
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3 }], -3);
		renderPanel();

		await page.getByRole('button', { name: 'Send the band list to the device' }).click();
		await vi.waitFor(() => expect(push).toHaveBeenCalled());
		const sent = push.mock.calls[0][0];
		expect(sent.filters).toHaveLength(10);
		expect(sent.filters[0]).toEqual({ type: 'PK', freq: 1000, q: 1, gain: 3 });
		expect(sent.preamp).toBe(-3);
		await expect.element(page.getByText('Wrote 1 band(s) to the device')).toBeVisible();
	});

	it('shows what fit changed and writes only once confirmed', async () => {
		const { conn, push } = peaksOnly();
		devicePeqStore.setConnected(conn, 4);
		eqStore.replace([{ type: 'LSC', freq: 105, q: 0.707, gain: 4 }], -4);
		renderPanel();

		await page.getByRole('button', { name: 'Send the band list to the device' }).click();
		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByText('Band 1 · Type: LSC → PK')).toBeVisible();
		await expect.element(dialog.getByText('Band 1 · Q: 0.707 → 0.71')).toBeVisible();
		expect(push).not.toHaveBeenCalled();

		await dialog.getByRole('button', { name: 'Write' }).click();
		await vi.waitFor(() => expect(push).toHaveBeenCalled());
		expect(push.mock.calls[0][0].filters[0]).toEqual({
			type: 'PK',
			freq: 105,
			q: 0.71,
			gain: 4
		});
	});

	it('offers no auto-write to a device that restarts to save, and reconnects after a write', async () => {
		const { conn, push } = peaksOnly();
		(conn.device.capabilities as { disconnectOnSave: boolean }).disconnectOnSave = true;
		push.mockResolvedValue({ reconnect: true });
		devicePeqStore.setConnected(conn, 4);
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3 }], -3);
		renderPanel();

		await expect.element(page.getByText('Write changes automatically')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Send the band list to the device' }).click();
		await expect
			.element(page.getByText('Saved. The device restarts after saving; reconnect to carry on.'))
			.toBeVisible();
		expect(conn.device.close).toHaveBeenCalled();
		await expect.element(page.getByRole('button', { name: 'Reconnect' }).first()).toBeVisible();
	});

	it('writes nothing when the review is cancelled', async () => {
		const { conn, push } = peaksOnly();
		devicePeqStore.setConnected(conn, 4);
		eqStore.replace([{ type: 'LSC', freq: 105, q: 0.7, gain: 4 }], -4);
		renderPanel();

		await page.getByRole('button', { name: 'Send the band list to the device' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
		expect(push).not.toHaveBeenCalled();
	});
});

describe('DevicePanel with the demo device', () => {
	beforeEach(() => {
		resetDemoDac();
		settingsStore.autoPushEnabled = false;
	});

	afterEach(async () => {
		await devicePeqService.disconnect();
		settingsStore.autoPushEnabled = true;
	});

	it('connects the demo device and reads its preset', async () => {
		renderPanel();
		render(BandList);

		await page.getByRole('button', { name: /simulated DAC/ }).click();
		await expect.element(page.getByText('uniPEQ Demo DAC')).toBeVisible();
		await expect.element(page.getByRole('button', { name: /^Device EQ.*USER1$/ })).toBeVisible();
		await expect.element(page.getByText('Simulated device')).toBeVisible();
		await expect.element(page.getByText('Community verified')).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'View in the eqcaps inspector' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Report wrong limits' }))
			.not.toBeInTheDocument();

		await page.getByRole('button', { name: "Replace the band list with the device's EQ" }).click();
		await expect.element(page.getByText('Read 10 band(s) from the device')).toBeVisible();
		await expect.element(page.getByRole('region', { name: /Bands 10/ })).toBeVisible();
		expect(eqStore.preamp).toBe(-4.5);
	});
});
