/**
 * Preset persistence. Backend: Web Storage (works on the web and in the Android WebView). The
 * interface is the stable part: swap in Capacitor Preferences/Filesystem without touching callers.
 *
 * Storage holds JSON and doesn't judge it: `parsePreset` (`$lib/eq/preset-file`) checks what comes
 * back and migrates schemaVersion 1.
 */
import type { PeqPreset } from '$lib/eq/model';

const INDEX_KEY = 'unipeq.presets.index';
const PRESET_KEY_PREFIX = 'unipeq.preset.';

export interface PresetIndexEntry {
	id: string;
	name: string;
	tags: string[];
	updatedAt: string;
}

export interface PresetStorage {
	list(): Promise<PresetIndexEntry[]>;
	/** The stored JSON, unvalidated: a prototype install holds schemaVersion 1 presets. */
	load(id: string): Promise<unknown>;
	save(preset: PeqPreset): Promise<void>;
	remove(id: string): Promise<void>;
}

export class LocalPresetStorage implements PresetStorage {
	/** `localStorage` unless given another Storage; resolved lazily so importing never touches it. */
	constructor(private readonly storage?: Storage) {}

	private get store(): Storage {
		return this.storage ?? localStorage;
	}

	async list(): Promise<PresetIndexEntry[]> {
		const raw = this.store.getItem(INDEX_KEY);
		return raw ? (JSON.parse(raw) as PresetIndexEntry[]) : [];
	}

	async load(id: string): Promise<unknown> {
		const raw = this.store.getItem(PRESET_KEY_PREFIX + id);
		return raw ? JSON.parse(raw) : undefined;
	}

	async save(preset: PeqPreset): Promise<void> {
		this.store.setItem(PRESET_KEY_PREFIX + preset.id, JSON.stringify(preset));
		const index = await this.list();
		const entry: PresetIndexEntry = {
			id: preset.id,
			name: preset.name,
			tags: preset.tags,
			updatedAt: preset.updatedAt
		};
		const existing = index.findIndex((e) => e.id === preset.id);
		if (existing >= 0) index[existing] = entry;
		else index.push(entry);
		this.store.setItem(INDEX_KEY, JSON.stringify(index));
	}

	async remove(id: string): Promise<void> {
		this.store.removeItem(PRESET_KEY_PREFIX + id);
		const index = (await this.list()).filter((e) => e.id !== id);
		this.store.setItem(INDEX_KEY, JSON.stringify(index));
	}
}

export const presetStorage: PresetStorage = new LocalPresetStorage();
