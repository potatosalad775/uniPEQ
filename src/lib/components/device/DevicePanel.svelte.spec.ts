import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Profile } from '@potatosalad775/eqcaps-core';
import type { Slot } from '@potatosalad775/eqcaps-device-bridge';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
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
		readsBandCount: false,
		controls: [],
		perChannel: false
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

describe('DevicePanel with a device that edits its presets', () => {
	type Device = Required<PeqDevice>;

	/**
	 * A DAC that keeps its own list of presets, with room for four, as a Topping does: it holds
	 * `names` and plays the first. A new preset is played; a delete moves the later ones down and
	 * leaves the device on the preset it played, or on its first.
	 */
	function listing(names = ['Bass', 'Airy', 'Warm']) {
		const held = [...names];
		let current = 0;
		const listed = (): Slot[] => held.map((name, id) => ({ id, name, writable: true }));
		const conn = fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
			canEnable: true,
			readsSlot: true,
			writesSlot: true,
			readsCurrentSlot: true,
			listsSlots: true,
			editsSlots: true,
			slots: [0, 1, 2, 3].map((id) => ({ id, name: `Config ${id + 1}`, writable: true }))
		});
		const device = conn.device as Device;
		device.currentSlot = async () => current;
		device.slots = async () => listed();
		const setEnabled = vi.fn<Device['setEnabled']>(async (_on, slot) => {
			current = slot ?? current;
		});
		const createSlot = vi.fn<Device['createSlot']>(async () => {
			held.push(`Config ${held.length + 1}`);
			current = held.length - 1;
			return listed()[current];
		});
		const renameSlot = vi.fn<Device['renameSlot']>(async (slot, name) => {
			held[slot] = name;
		});
		const deleteSlot = vi.fn<Device['deleteSlot']>(async (slot) => {
			held.splice(slot, 1);
			current = slot === current ? 0 : current - Number(slot < current);
		});
		Object.assign(device, { setEnabled, createSlot, renameSlot, deleteSlot });
		devicePeqStore.setConnected(conn, 0, true, listed());
		return { setEnabled, createSlot, renameSlot, deleteSlot };
	}

	const sheet = () => page.getByRole('dialog', { name: 'Presets on the device' });
	/** A row of the sheet, by its label alone: not its ⋮ ("More actions for …"). */
	const row = (name: string) => sheet().getByRole('button', { name, exact: true });
	const more = (name: string) => sheet().getByRole('button', { name: `More actions for ${name}` });

	async function openSheet() {
		await page.getByRole('button', { name: /^Device EQ/ }).click();
		await expect.element(sheet()).toBeVisible();
	}

	afterEach(() => devicePeqStore.forget());

	it('opens from one row: what is used, the choices in order with the current checked', async () => {
		listing();
		renderPanel();

		await expect
			.element(page.getByRole('button', { name: /^Presets on the device/ }))
			.not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /^Device EQ.*Bass$/ })).toBeVisible();
		await openSheet();
		await expect.element(sheet().getByText('3 of 4 used')).toBeVisible();
		const rows = sheet().getByRole('listitem').elements();
		expect(rows.map((li) => li.textContent?.trim())).toEqual([
			'Bass',
			'Airy',
			'Warm',
			'Off (EQ bypassed)',
			'New preset'
		]);
		await expect.element(row('Bass')).toHaveAttribute('aria-current', 'true');
		await expect.element(row('Airy')).not.toHaveAttribute('aria-current');
		// A ⋮ on each preset, none on Off.
		expect(
			sheet()
				.getByRole('button', { name: /^More actions for/ })
				.elements()
		).toHaveLength(3);
		await expect.element(row('New preset')).toBeEnabled();
	});

	it('plays the preset picked and closes', async () => {
		const { setEnabled } = listing();
		renderPanel();

		await openSheet();
		await row('Airy').click();
		await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith(true, 1));
		await expect.element(sheet()).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /^Device EQ.*Airy$/ })).toBeVisible();
	});

	it('renames and deletes the preset whose ⋮ was used, not the one playing', async () => {
		const { renameSlot, deleteSlot, setEnabled } = listing();
		renderPanel();

		await openSheet();
		await more('Airy').click();
		await page.getByRole('menuitem', { name: 'Rename “Airy”…' }).click();
		const renaming = page.getByRole('dialog', { name: 'Rename preset' });
		const name = renaming.getByRole('textbox', { name: 'Name' });
		await expect.element(name).toHaveValue('Airy');
		await name.fill('Mids');
		await renaming.getByRole('button', { name: 'Rename' }).click();
		await vi.waitFor(() => expect(renameSlot).toHaveBeenCalledWith(1, 'Mids'));
		await expect.element(renaming).not.toBeInTheDocument();
		await expect.element(row('Mids')).toBeVisible();
		await expect.element(page.getByText('Renamed the preset to “Mids”.')).toBeVisible();

		await more('Warm').click();
		await page.getByRole('menuitem', { name: 'Delete “Warm”…' }).click();
		await page
			.getByRole('dialog', { name: 'Delete “Warm”?' })
			.getByRole('button', { name: 'Delete' })
			.click();
		await vi.waitFor(() => expect(deleteSlot).toHaveBeenCalledWith(2));
		await expect.element(row('Warm')).not.toBeInTheDocument();
		await expect.element(page.getByText('Deleted “Warm” from the device.')).toBeVisible();
		await expect.element(row('Bass')).toHaveAttribute('aria-current', 'true');
		expect(setEnabled).not.toHaveBeenCalled();
	});

	it('keeps Rename open and says why when the device refuses the name', async () => {
		const { renameSlot } = listing();
		renameSlot.mockRejectedValueOnce(
			Object.assign(new Error('too long'), { name: 'BridgeError', code: 'invalid-request' })
		);
		renderPanel();

		await openSheet();
		await more('Bass').click();
		await page.getByRole('menuitem', { name: 'Rename “Bass”…' }).click();
		const renaming = page.getByRole('dialog', { name: 'Rename preset' });
		await renaming.getByRole('textbox', { name: 'Name' }).fill('a name far too long');
		await renaming.getByRole('button', { name: 'Rename' }).click();
		await expect.element(renaming.getByRole('alert')).toMatchTextContent(/store that name/);
		expect(devicePeqStore.slots.map((s) => s.name)).toEqual(['Bass', 'Airy', 'Warm']);
	});

	it('adds no preset to a full device', async () => {
		listing(['A', 'B', 'C', 'D']);
		renderPanel();
		await openSheet();
		const add = sheet().getByRole('button', { name: /^New preset/ });
		await expect.element(add).toBeDisabled();
		await expect.element(add).toMatchTextContent(/no room for another/);
	});

	it("keeps the device's only preset, and still opens from its row", async () => {
		listing(['Only']);
		renderPanel();
		await openSheet();
		await more('Only').click();
		await expect
			.element(page.getByRole('menuitem', { name: 'Delete “Only”…' }))
			.toHaveAttribute('aria-disabled', 'true');
	});

	it('adds a preset, with every row off while the device is busy', async () => {
		const { createSlot } = listing();
		let finish = () => {};
		const made = createSlot.getMockImplementation()!;
		createSlot.mockImplementationOnce(
			() => new Promise((resolve) => (finish = () => resolve(made())))
		);
		renderPanel();

		await openSheet();
		await row('New preset').click();
		for (const button of [row('Bass'), more('Bass'), row('Off (EQ bypassed)'), row('New preset')]) {
			await expect.element(button).toBeDisabled();
		}
		finish();
		await expect.element(row('Config 4')).toHaveAttribute('aria-current', 'true');
		await expect.element(row('Bass')).toBeEnabled();
		await expect.element(sheet()).toBeVisible();
	});

	it('leaves a device that cannot edit its presets with its menu, and no sheet', async () => {
		devicePeqStore.setConnected(
			fakeConnection(hardwareProfile('dac', { bandCount: 8 }), {
				readsSlot: true,
				writesSlot: true,
				slots: [
					{ id: 1, name: 'USER1' },
					{ id: 2, name: 'USER2' }
				]
			}),
			null
		);
		renderPanel();

		await page.getByRole('button', { name: /^Device preset.*USER1$/ }).click();
		await expect.element(page.getByRole('menuitemradio', { name: 'USER2' })).toBeVisible();
		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});
});
