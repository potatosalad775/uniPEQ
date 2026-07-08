import { defineStore } from 'pinia';
import type { EqState, PeqPreset } from '@/core/model/types';
import { presetStorage, validatePreset, parseAutoEqText, type PresetIndexEntry } from '@/services/presetStorage';
import { logger } from '@/services/logger';

const APP_VERSION = '0.0.1';

interface PresetStoreState {
  index: PresetIndexEntry[];
  search: string;
}

export const usePresetStore = defineStore('presets', {
  state: (): PresetStoreState => ({
    index: [],
    search: '',
  }),

  getters: {
    filteredIndex(state): PresetIndexEntry[] {
      const q = state.search.trim().toLowerCase();
      if (!q) return state.index;
      return state.index.filter(
        (e) => e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    },
  },

  actions: {
    async refresh() {
      this.index = await presetStorage.list();
    },

    async load(id: string): Promise<PeqPreset | undefined> {
      return presetStorage.load(id);
    },

    async saveFromEqState(name: string, state: EqState, sourceDeviceId?: string): Promise<PeqPreset> {
      const now = new Date().toISOString();
      const preset: PeqPreset = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name,
        tags: [],
        createdAt: now,
        updatedAt: now,
        source: { deviceId: sourceDeviceId, app: 'uniPEQ', appVersion: APP_VERSION },
        pregain: state.pregain,
        filters: state.filters.map((f) => ({ ...f })),
      };
      await presetStorage.save(preset);
      await this.refresh();
      return preset;
    },

    async update(preset: PeqPreset) {
      preset.updatedAt = new Date().toISOString();
      await presetStorage.save(preset);
      await this.refresh();
    },

    async duplicate(id: string) {
      const preset = await presetStorage.load(id);
      if (!preset) return;
      const now = new Date().toISOString();
      await presetStorage.save({
        ...preset,
        id: crypto.randomUUID(),
        name: `${preset.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      });
      await this.refresh();
    },

    async remove(id: string) {
      await presetStorage.remove(id);
      await this.refresh();
    },

    async importText(text: string, fileName: string): Promise<PeqPreset> {
      let preset: PeqPreset;
      try {
        // Try JSON first; fall back to AutoEq ParametricEQ txt.
        preset = validatePreset(JSON.parse(text));
        // Imports get a fresh id to avoid clobbering an existing preset.
        preset = { ...preset, id: crypto.randomUUID() };
      } catch (jsonError) {
        try {
          preset = parseAutoEqText(text, fileName.replace(/\.(txt|json)$/i, ''));
        } catch {
          throw jsonError instanceof SyntaxError
            ? new Error('File is neither valid preset JSON nor AutoEq ParametricEQ text')
            : jsonError;
        }
      }
      await presetStorage.save(preset);
      await this.refresh();
      logger.info(`Imported preset "${preset.name}"`);
      return preset;
    },

    async exportPreset(id: string): Promise<string | undefined> {
      const preset = await presetStorage.load(id);
      return preset ? JSON.stringify(preset, null, 2) : undefined;
    },
  },
});
