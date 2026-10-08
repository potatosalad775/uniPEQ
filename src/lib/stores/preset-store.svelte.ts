/**
 * Saved presets: the list, and moving presets between storage, the EQ and files. Every preset
 * read back goes through `parsePreset`, so a prototype install's schemaVersion 1 presets load as
 * v2 (rebuild decision 5); they are stored as v2 the next time they are saved.
 */
import { presetFit, type PresetFit } from '$lib/device-peq/preset-fit';
import type { PeqCapabilities } from '$lib/device-peq/types';
import { formatApo } from '$lib/eq/eq-apo';
import { padToBandCount } from '$lib/eq/eq-constraint';
import { derivePreamp } from '$lib/eq/eq-preamp';
import type { PeqPreset } from '$lib/eq/model';
import {
	createPreset,
	editedPreset,
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
import type { Profile } from '@potatosalad775/eqcaps-core';
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
	async saveCurrent(name: string, tags: string[] = []): Promise<PeqPreset> {
		const preset = createPreset({
			name,
			filters: eqStore.filters,
			pregain: eqStore.pregain,
			deviceId: devicePeqStore.connection?.profileId ?? undefined,
			tags
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
		// A device's bands are a set number (decision 23): a shorter preset is padded with flat
		// bands, which sound the same. What doesn't fit is still only flagged; Fit is the user's.
		const profile = devicePeqStore.knownDevice?.profile;
		const filters = parsed.preset.filters;
		eqStore.replace(profile ? padToBandCount(filters, profile) : filters, parsed.preset.pregain);
		return parsed;
	}

	/** Store a preset from a file's text. Throws a `PresetError` when the text is no preset. */
	async importText(text: string, fileName: string): Promise<ImportedPreset> {
		const imported = importPreset(text, fileName);
		await this.storage.save(imported.preset);
		await this.refresh();
		return imported;
	}

	/** Rename a stored preset or change its tags. */
	async edit(id: string, changes: { name?: string; tags?: string[] }): Promise<PeqPreset> {
		const next = editedPreset((await this.load(id)).preset, changes);
		await this.storage.save(next);
		await this.refresh();
		return next;
	}

	/** Store a copy of a preset under a fresh id, named `name`. */
	async duplicate(id: string, name: string): Promise<PeqPreset> {
		const { preset } = await this.load(id);
		const copy = createPreset({
			name,
			filters: preset.filters,
			pregain: preset.pregain,
			deviceId: preset.source?.deviceId,
			tags: preset.tags
		});
		await this.storage.save(copy);
		await this.refresh();
		return copy;
	}

	async remove(id: string): Promise<void> {
		await this.storage.remove(id);
		await this.refresh();
	}

	/** How each listed preset fits a device, by id. A damaged preset is left out. */
	async fits(
		profile: Profile,
		capabilities: Pick<PeqCapabilities, 'writesPreamp'>
	): Promise<Record<string, PresetFit>> {
		const out: Record<string, PresetFit> = {};
		for (const entry of this.index) {
			try {
				out[entry.id] = presetFit((await this.load(entry.id)).preset, profile, capabilities);
			} catch {
				// Loading it reports the damage; the list just shows no badge.
			}
		}
		return out;
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
