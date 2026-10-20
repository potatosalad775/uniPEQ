import { describe, expect, it } from 'vitest';
import type { PeqPreset } from '#lib/eq/model.js';
import { LocalPresetStorage, searchPresets } from './preset-storage';

class MemoryStorage implements Storage {
	#items = new Map<string, string>();
	get length() {
		return this.#items.size;
	}
	clear() {
		this.#items.clear();
	}
	getItem(key: string) {
		return this.#items.get(key) ?? null;
	}
	key(index: number) {
		return [...this.#items.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.#items.delete(key);
	}
	setItem(key: string, value: string) {
		this.#items.set(key, value);
	}
}

const preset = (id: string, name: string): PeqPreset => ({
	schemaVersion: 2,
	id,
	name,
	tags: ['test'],
	createdAt: '2026-10-06T00:00:00.000Z',
	updatedAt: '2026-10-06T00:00:00.000Z',
	pregain: 'auto',
	filters: [{ type: 'LSC', freq: 105, q: 0.7, gain: 4 }]
});

describe('LocalPresetStorage', () => {
	it('saves, lists and loads presets', async () => {
		const storage = new LocalPresetStorage(new MemoryStorage());
		await storage.save(preset('a', 'Bass'));
		await storage.save(preset('b', 'Vocal'));

		expect((await storage.list()).map((e) => e.name)).toEqual(['Bass', 'Vocal']);
		expect(await storage.load('a')).toEqual(preset('a', 'Bass'));
		expect(await storage.load('missing')).toBeUndefined();
	});

	it('updates an existing index entry in place', async () => {
		const storage = new LocalPresetStorage(new MemoryStorage());
		await storage.save(preset('a', 'Bass'));
		await storage.save(preset('b', 'Vocal'));
		await storage.save({ ...preset('a', 'Bass v2'), updatedAt: '2026-10-07T00:00:00.000Z' });

		const index = await storage.list();
		expect(index.map((e) => [e.id, e.name])).toEqual([
			['a', 'Bass v2'],
			['b', 'Vocal']
		]);
		expect(index[0].updatedAt).toBe('2026-10-07T00:00:00.000Z');
	});

	it('removes a preset and its index entry', async () => {
		const backing = new MemoryStorage();
		const storage = new LocalPresetStorage(backing);
		await storage.save(preset('a', 'Bass'));
		await storage.remove('a');

		expect(await storage.list()).toEqual([]);
		expect(await storage.load('a')).toBeUndefined();
		expect(backing.length).toBe(1); // just the empty index
	});

	it('reads what the Vue prototype stored, under the same keys', async () => {
		const backing = new MemoryStorage();
		backing.setItem(
			'unipeq.presets.index',
			JSON.stringify([{ id: 'old', name: 'Old', tags: [], updatedAt: '2026-01-01' }])
		);
		backing.setItem('unipeq.preset.old', JSON.stringify({ schemaVersion: 1, id: 'old' }));
		const storage = new LocalPresetStorage(backing);

		expect((await storage.list())[0].id).toBe('old');
		expect(await storage.load('old')).toEqual({ schemaVersion: 1, id: 'old' });
	});
});

describe('searchPresets', () => {
	const index = [
		{ id: '1', name: 'Bass boost', tags: ['warm'], updatedAt: '2026-01-01' },
		{ id: '2', name: 'Vocal', tags: ['bright', 'IEM'], updatedAt: '2026-03-01' },
		{ id: '3', name: 'Flat', tags: [], updatedAt: '2026-02-01' }
	];

	it('lists everything newest first for an empty query', () => {
		expect(searchPresets(index, ' ').map((e) => e.id)).toEqual(['2', '3', '1']);
	});

	it('matches every word in the name or a tag, ignoring case', () => {
		expect(searchPresets(index, 'iem').map((e) => e.id)).toEqual(['2']);
		expect(searchPresets(index, 'boost WARM').map((e) => e.id)).toEqual(['1']);
		expect(searchPresets(index, 'boost bright')).toEqual([]);
	});
});
