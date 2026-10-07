/**
 * Saved presets: the list, and moving presets between storage, the EQ and files. Every preset
 * read back goes through `parsePreset`, so a prototype install's schemaVersion 1 presets load as
 * v2 (rebuild decision 5); they are stored as v2 the next time they are saved.
 */
import { formatApo } from '$lib/eq/eq-apo';
import { derivePreamp } from '$lib/eq/eq-preamp';
import type { PeqPreset } from '$lib/eq/model';
import {
	createPreset,
	importPreset,
	parsePreset,
	presetJson,
	type ImportedPreset,
	type ParsedPreset
} from '$lib/eq/preset-file';
import {
	presetStorage,
	type PresetIndexEntry,
	type PresetStorage
} from '$lib/services/preset-storage';
import { devicePeqStore } from './device-peq-store.svelte';
import { eqStore } from './eq-store.svelte';

export class PresetStore {
	index = $state.raw<PresetIndexEntry[]>([]);

	constructor(private readonly storage: PresetStorage = presetStorage) {}

	async refresh(): Promise<void> {
		this.index = await this.storage.list();
	}

	/** A stored preset, migrated to v2. Throws a `PresetError` for a damaged one. */
	async load(id: string): Promise<ParsedPreset> {
		return parsePreset(await this.storage.load(id));
	}

	/** Save the EQ as it is now under `name`, naming the connected device's profile. */
	async saveCurrent(name: string): Promise<PeqPreset> {
		const preset = createPreset({
			name,
			filters: eqStore.filters,
			pregain: eqStore.pregain,
			deviceId: devicePeqStore.connection?.profileId ?? undefined
		});
		await this.storage.save(preset);
		await this.refresh();
		return preset;
	}

	/**
	 * Replace the EQ with a stored preset, as one undoable step. With auto-write on, the device
	 * follows (after a review when it can't hold the preset as it is).
	 */
	async apply(id: string): Promise<ParsedPreset> {
		const parsed = await this.load(id);
		eqStore.replace(parsed.preset.filters, parsed.preset.pregain);
		return parsed;
	}

	/** Store a preset from a file's text. Throws a `PresetError` when the text is no preset. */
	async importText(text: string, fileName: string): Promise<ImportedPreset> {
		const imported = importPreset(text, fileName);
		await this.storage.save(imported.preset);
		await this.refresh();
		return imported;
	}

	async remove(id: string): Promise<void> {
		await this.storage.remove(id);
		await this.refresh();
	}

	/** A stored preset as a file: uniPEQ JSON, or Equalizer APO text. */
	async exportFile(
		id: string,
		format: 'json' | 'apo'
	): Promise<{ name: string; text: string; type: string }> {
		const { preset } = await this.load(id);
		const base = preset.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'preset';
		if (format === 'json') {
			return { name: `${base}.json`, text: presetJson(preset), type: 'application/json' };
		}
		const preamp = preset.pregain === 'auto' ? derivePreamp(preset.filters) : preset.pregain;
		return { name: `${base}.txt`, text: formatApo(preset.filters, preamp), type: 'text/plain' };
	}
}

export const presetStore = new PresetStore();
