import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceConnection, PeqCapabilities } from '$lib/device-peq/types';
import { devicePeqStore } from './device-peq-store.svelte';
import { eqStore } from './eq-store.svelte';

const KA17_SLOTS = [
	{ id: 0, name: 'Jazz' },
	{ id: 4, name: 'USER1', writable: true },
	{ id: 8, name: 'USER2', writable: true },
	{ id: 9, name: 'USER3', writable: true },
	{ id: 10, name: 'BYPASS', bypass: true }
];

function connection(
	over: Partial<PeqCapabilities> = {},
	profileId = 'fiio-ka17'
): DeviceConnection {
	const capabilities: PeqCapabilities = {
		canRead: true,
		canWrite: true,
		readsPreamp: true,
		readsSlot: false,
		writesPreamp: true,
		writesSlot: false,
		readsCurrentSlot: true,
		canEnable: true,
		slots: KA17_SLOTS,
		disconnectOnSave: false,
		experimental: false,
		...over
	};
	return {
		device: {
			capabilities,
			pull: vi.fn(),
			push: vi.fn(),
			currentSlot: vi.fn(),
			setEnabled: vi.fn(),
			close: vi.fn()
		},
		connectionType: 'hid',
		name: 'FiiO KA17',
		profile: { id: profileId } as Profile,
		profileSource: 'device',
		profileId,
		identity: {}
	};
}

describe('devicePeqStore', () => {
	it('targets the preset the device is on, and hides the bypass preset from the list', () => {
		devicePeqStore.setConnected(connection(), 8);
		expect(devicePeqStore.activeSlot).toBe(8);
		expect(devicePeqStore.eqEnabled).toBe(true);
		expect(devicePeqStore.slots.map((s) => s.id)).toEqual([0, 4, 8, 9]);
		expect(devicePeqStore.bypass?.id).toBe(10);
	});

	it('reads the bypass preset as EQ off', () => {
		devicePeqStore.setConnected(connection(), 10);
		expect(devicePeqStore.selection).toBe('off');
		expect(devicePeqStore.activeSlot).toBe(0);
	});

	it('writes only user presets, and never retargets to one', () => {
		devicePeqStore.setConnected(connection(), 0);
		expect(devicePeqStore.writableSlots.map((s) => s.name)).toEqual(['USER1', 'USER2', 'USER3']);
		expect(devicePeqStore.targetWritable).toBe(false);
		expect(devicePeqStore.writeTarget).toBeNull();
		expect(devicePeqStore.readTarget).toEqual({});

		devicePeqStore.played(4);
		expect(devicePeqStore.writeTarget).toEqual({});
	});

	it('writes to every preset but the bypass one when the profile marks none', () => {
		const slots = KA17_SLOTS.map(({ id, name, bypass }) => ({ id, name, bypass }));
		devicePeqStore.setConnected(connection({ slots }), 0);
		expect(devicePeqStore.writableSlots.map((s) => s.id)).toEqual([0, 4, 8, 9]);
		expect(devicePeqStore.targetWritable).toBe(true);
	});

	it('reaches a preset the device is not on only when the protocol names slots', () => {
		devicePeqStore.setConnected(connection(), 4);
		devicePeqStore.target(8);
		expect(devicePeqStore.readTarget).toBeNull();
		expect(devicePeqStore.writeTarget).toBeNull();

		devicePeqStore.setConnected(connection({ readsSlot: true, writesSlot: true }), 4);
		devicePeqStore.target(8);
		expect(devicePeqStore.readTarget).toEqual({ slot: 8 });
		expect(devicePeqStore.writeTarget).toEqual({ slot: 8 });
	});

	it('counts a guessed device as experimental', () => {
		const guess = { ...connection(), profileSource: 'guess' as const, profileId: null };
		devicePeqStore.setConnected(guess, null);
		expect(devicePeqStore.experimental).toBe(true);
		devicePeqStore.setDisconnected();
		expect(devicePeqStore.isConnected).toBe(false);
		expect(devicePeqStore.experimental).toBe(false);
	});

	it('keeps the device the EQ is for after a disconnect, until forgotten', () => {
		devicePeqStore.setConnected(connection(), null);
		devicePeqStore.setDisconnected();
		expect(devicePeqStore.knownDevice?.name).toBe(connection().name);
		expect(devicePeqStore.knownDevice?.profile).toEqual(connection().profile);
		devicePeqStore.forget();
		expect(devicePeqStore.knownDevice).toBeNull();
	});

	describe('unwritten changes and editing', () => {
		const band = (gain: number) => ({ type: 'PK' as const, freq: 1000, gain, q: 1 });

		function connectedAndRead() {
			devicePeqStore.forget();
			eqStore.reset();
			devicePeqStore.setConnected(connection(), 4);
			eqStore.replace([band(3)]);
			devicePeqStore.synced = { filters: eqStore.filters, preamp: eqStore.preamp };
		}

		it('edits only while connected and reachable', () => {
			connectedAndRead();
			expect(devicePeqStore.canEdit).toBe(true);
			devicePeqStore.needsReconnect = true;
			expect(devicePeqStore.canEdit).toBe(false);
			devicePeqStore.setDisconnected();
			expect(devicePeqStore.canEdit).toBe(false);
		});

		it('carries changes the device never got across a disconnect, to the same device only', () => {
			connectedAndRead();
			eqStore.update(0, { gain: 5 });
			expect(devicePeqStore.hasUnwritten).toBe(true);
			devicePeqStore.setDisconnected();
			expect(devicePeqStore.unwritten).toBe(true);

			devicePeqStore.setConnected(connection(), 4);
			expect(devicePeqStore.unwritten).toBe(true);
			expect(devicePeqStore.hasUnwritten).toBe(true);

			devicePeqStore.setDisconnected();
			devicePeqStore.setConnected({ ...connection(), name: 'FiiO KA15' }, 4);
			expect(devicePeqStore.hasUnwritten).toBe(false);
		});

		it('carries nothing when the list was as the device had it', () => {
			connectedAndRead();
			devicePeqStore.setDisconnected();
			devicePeqStore.setConnected(connection(), 4);
			expect(devicePeqStore.hasUnwritten).toBe(false);
		});

		it('counts an edit made before any read or write', () => {
			devicePeqStore.forget();
			eqStore.reset();
			devicePeqStore.setConnected(connection(), 4);
			expect(devicePeqStore.hasUnwritten).toBe(false);
			eqStore.add(band(2));
			expect(devicePeqStore.hasUnwritten).toBe(true);
		});

		it('keeps changes made for one preset unwritten after switching to another', () => {
			connectedAndRead();
			eqStore.update(0, { gain: 6 });
			devicePeqStore.target(8);
			expect(devicePeqStore.hasUnwritten).toBe(true);

			connectedAndRead();
			devicePeqStore.target(8);
			expect(devicePeqStore.hasUnwritten).toBe(false);
		});

		it('drops the band selection on a disconnect', () => {
			connectedAndRead();
			eqStore.select(0);
			devicePeqStore.setDisconnected();
			expect(eqStore.selected).toBeNull();
		});
	});
});
