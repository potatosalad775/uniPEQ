import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { parseApo } from '#lib/eq/eq-apo.js';
import { LocalPresetStorage } from '#lib/services/preset-storage.js';
import { devicePeqStore } from './device-peq-store.svelte';
import { eqStore } from './eq-store.svelte';
import { PresetStore } from './preset-store.svelte';

/** Web Storage over a Map: what the store sees of localStorage. */
function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k) => data.get(k) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (k) => void data.delete(k),
		setItem: (k, v) => void data.set(k, v)
	};
}

/** A preset as the Vue prototype stored it. */
const V1_PRESET = {
	schemaVersion: 1,
	id: 'proto',
	name: 'From the prototype',
	tags: [],
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	pregain: 'auto',
	filters: [
		{ type: 'LSQ', freq: 105, gain: 6, q: 0.7 },
		{ type: 'BSF', freq: 3000, gain: -3, q: 2 }
	]
};

describe('PresetStore', () => {
	let storage: Storage;
	let store: PresetStore;

	beforeEach(() => {
		storage = memoryStorage();
		store = new PresetStore(new LocalPresetStorage(storage));
		eqStore.replace([], 0);
	});

	afterEach(() => devicePeqStore.forget());

	it('saves the EQ as it is, preamp mode included, and lists it', async () => {
		eqStore.replace([{ type: 'PK', freq: 1000, q: 1, gain: 3 }], 'auto');
		const saved = await store.saveCurrent('Mine');
		expect(saved.pregain).toBe('auto');
		expect(store.index.map((e) => e.name)).toEqual(['Mine']);
		expect((await store.load(saved.id)).preset).toEqual(saved);
	});

	it('loads a prototype preset, migrated, into the EQ', async () => {
		storage.setItem('unipeq.preset.proto', JSON.stringify(V1_PRESET));
		const { dropped } = await store.apply('proto');
		expect(dropped).toBe(1);
		expect(eqStore.filters.map((f) => f.type)).toEqual(['LSC']);
		// `pregain: 'auto'` follows the bands: -6 dB for a +6 dB shelf.
		expect(eqStore.autoPreamp).toBe(true);
		expect(eqStore.preamp).toBe(-6);
	});

	it("pads a shorter preset with flat bands to the device's count", async () => {
		storage.setItem('unipeq.preset.proto', JSON.stringify(V1_PRESET));
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 4 })), null);
		await store.apply('proto');
		expect(eqStore.filters).toHaveLength(4);
		expect(eqStore.filters[0]).toMatchObject({ type: 'LSC', gain: 6 });
		expect(eqStore.filters.slice(1).every((f) => f.gain === 0)).toBe(true);
	});

	it('imports a file under a fresh id and stores it as v2', async () => {
		const { preset } = await store.importText(
			'Preamp: -3 dB\nFilter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1',
			'HD 600.txt'
		);
		expect(store.index.map((e) => e.name)).toEqual(['HD 600']);
		expect(JSON.parse(storage.getItem(`unipeq.preset.${preset.id}`)!).schemaVersion).toBe(2);
	});

	it('exports JSON and APO text, working out an auto preamp', async () => {
		storage.setItem('unipeq.preset.proto', JSON.stringify(V1_PRESET));
		const json = await store.exportFile('proto', 'json');
		expect(json.name).toBe('From the prototype.json');
		expect(JSON.parse(json.text).filters[0].type).toBe('LSC');

		const apo = await store.exportFile('proto', 'apo');
		expect(apo.name).toBe('From the prototype.txt');
		expect(parseApo(apo.text).preamp).toBe(-6);
	});

	it('removes a preset', async () => {
		const saved = await store.saveCurrent('Gone');
		await store.remove(saved.id);
		expect(store.index).toEqual([]);
	});

	it('renames and retags a preset, keeping its bands', async () => {
		const saved = await store.saveCurrent('Old', ['a']);
		await store.edit(saved.id, { name: 'New', tags: ['b', 'c'] });
		expect(store.index).toEqual([expect.objectContaining({ name: 'New', tags: ['b', 'c'] })]);
		const { preset } = await store.load(saved.id);
		expect(preset.filters).toEqual(saved.filters);
	});

	it('duplicates a preset under a fresh id', async () => {
		const saved = await store.saveCurrent('Base', ['x']);
		const copy = await store.duplicate(saved.id, 'Base (copy)');
		expect(copy.id).not.toBe(saved.id);
		expect(store.index.map((e) => e.name).sort()).toEqual(['Base', 'Base (copy)']);
		expect((await store.load(copy.id)).preset).toMatchObject({
			filters: saved.filters,
			tags: ['x']
		});
	});

	describe('with the channels apart', () => {
		const pk = (gain: number) => ({ type: 'PK' as const, freq: 1000, q: 1, gain });
		const stereo = {
			...hardwareProfile('dx5', { bandCount: 2 }),
			channels: 'independent' as const
		};

		function apart() {
			eqStore.load({
				filters: [pk(1), pk(2)],
				preamp: -2,
				right: { filters: [pk(3), pk(4)], preamp: 'auto' }
			});
		}

		it('saves both channels, and an EQ linked as one list', async () => {
			apart();
			const both = await store.saveCurrent('Both');
			expect(both.filters).toEqual([pk(1), pk(2)]);
			expect(both.pregain).toBe(-2);
			expect(both.right).toEqual({ pregain: 'auto', filters: [pk(3), pk(4)] });

			eqStore.edit('both');
			expect((await store.saveCurrent('One')).right).toBeUndefined();
		});

		it('loads both channels apart onto a device that holds them apart', async () => {
			apart();
			const saved = await store.saveCurrent('Both');
			devicePeqStore.setConnected(fakeConnection(stereo, { perChannel: true }), null);
			eqStore.reset();
			const { leftOnly } = await store.apply(saved.id);
			expect(leftOnly).toBe(false);
			expect(eqStore.linked).toBe(false);
			expect(eqStore.channels.left.filters).toEqual([pk(1), pk(2)]);
			expect(eqStore.channels.right.filters).toEqual([pk(3), pk(4)]);
			expect(eqStore.channels.right.autoPreamp).toBe(true);
		});

		it('loads the left channel onto a device with one EQ for both, and says so', async () => {
			apart();
			const saved = await store.saveCurrent('Both');
			devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 2 })), null);
			eqStore.reset();
			const { leftOnly } = await store.apply(saved.id);
			expect(leftOnly).toBe(true);
			expect(eqStore.linked).toBe(true);
			expect(eqStore.filters).toEqual([pk(1), pk(2)]);
		});

		it('loads a one-list preset as one list, even onto a device that holds them apart', async () => {
			eqStore.load({ filters: [pk(5), pk(6)] });
			const saved = await store.saveCurrent('One');
			devicePeqStore.setConnected(fakeConnection(stereo, { perChannel: true }), null);
			apart();
			const { leftOnly } = await store.apply(saved.id);
			expect(leftOnly).toBe(false);
			expect(eqStore.linked).toBe(true);
			expect(eqStore.filters).toEqual([pk(5), pk(6)]);
		});

		it('imports and exports the right channel; APO text gets a section per channel', async () => {
			apart();
			const saved = await store.saveCurrent('Both');
			const json = await store.exportFile(saved.id, 'json');
			const { preset } = await store.importText(json.text, json.name);
			expect(preset.right).toEqual(saved.right);
			expect(preset.id).not.toBe(saved.id);

			const apo = await store.exportFile(saved.id, 'apo');
			const lines = apo.text.trim().split('\n');
			expect(lines.filter((l) => !l.startsWith('Filter'))).toEqual([
				'Channel: L',
				'Preamp: -2.0 dB',
				'Channel: R',
				// Auto: two 1 kHz peaks of 3 and 4 dB.
				'Preamp: -7.0 dB'
			]);
			expect(lines.filter((l) => l.startsWith('Filter'))).toHaveLength(4);
		});

		it('copies the right channel with a duplicate', async () => {
			apart();
			const saved = await store.saveCurrent('Both');
			const copy = await store.duplicate(saved.id, 'Both (copy)');
			expect(copy.right).toEqual(saved.right);
		});
	});
});
