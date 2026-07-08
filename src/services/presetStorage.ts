/**
 * Preset persistence. Prototype backend: localStorage (works in web + WebView).
 * The interface is the stable part — swap in Capacitor Preferences/Filesystem
 * on Android without touching callers.
 */
import type { PeqPreset } from '@/core/model/types';

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
  load(id: string): Promise<PeqPreset | undefined>;
  save(preset: PeqPreset): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Validates an imported object; migrates older schemaVersions when they exist. */
export function validatePreset(raw: unknown): PeqPreset {
  const p = raw as Partial<PeqPreset>;
  if (!p || typeof p !== 'object') throw new Error('Preset must be a JSON object');
  if (p.schemaVersion !== 1) throw new Error(`Unsupported preset schemaVersion: ${p.schemaVersion}`);
  if (typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Preset needs "id" and "name"');
  if (!Array.isArray(p.filters)) throw new Error('Preset "filters" must be an array');
  for (const f of p.filters) {
    if (typeof f.freq !== 'number' || typeof f.gain !== 'number' || typeof f.q !== 'number') {
      throw new Error('Each filter needs numeric freq/gain/q');
    }
  }
  if (p.pregain !== 'auto' && typeof p.pregain !== 'number') throw new Error('Preset "pregain" must be a number or "auto"');
  return { tags: [], ...p } as PeqPreset;
}

/**
 * Parse AutoEq-style ParametricEQ txt:
 *   Preamp: -6.4 dB
 *   Filter 1: ON PK Fc 105 Hz Gain -4.6 dB Q 0.70
 */
export function parseAutoEqText(text: string, name: string): PeqPreset {
  const filters: PeqPreset['filters'] = [];
  let pregain: number | 'auto' = 'auto';
  const typeMap: Record<string, PeqPreset['filters'][number]['type']> = {
    PK: 'PK', LS: 'LSQ', LSC: 'LSQ', HS: 'HSQ', HSC: 'HSQ', LP: 'LPF', HP: 'HPF', NO: 'NOTCH', BP: 'BPF',
  };
  for (const line of text.split(/\r?\n/)) {
    const preampMatch = line.match(/^\s*Preamp:\s*(-?[\d.]+)\s*dB/i);
    if (preampMatch) {
      pregain = parseFloat(preampMatch[1]);
      continue;
    }
    const filterMatch = line.match(
      /^\s*Filter\s*\d+:\s*(ON|OFF)\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/i,
    );
    if (filterMatch) {
      const type = typeMap[filterMatch[2].toUpperCase()];
      if (!type) continue;
      filters.push({
        type,
        freq: parseFloat(filterMatch[3]),
        gain: parseFloat(filterMatch[4]),
        q: filterMatch[5] ? parseFloat(filterMatch[5]) : 0.707,
        enabled: filterMatch[1].toUpperCase() === 'ON',
      });
    }
  }
  if (filters.length === 0) throw new Error('No filters found — is this an AutoEq ParametricEQ file?');
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    tags: ['autoeq'],
    createdAt: now,
    updatedAt: now,
    pregain,
    filters,
  };
}

export class LocalPresetStorage implements PresetStorage {
  async list(): Promise<PresetIndexEntry[]> {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as PresetIndexEntry[]) : [];
  }

  async load(id: string): Promise<PeqPreset | undefined> {
    const raw = localStorage.getItem(PRESET_KEY_PREFIX + id);
    return raw ? (JSON.parse(raw) as PeqPreset) : undefined;
  }

  async save(preset: PeqPreset): Promise<void> {
    localStorage.setItem(PRESET_KEY_PREFIX + preset.id, JSON.stringify(preset));
    const index = await this.list();
    const entry: PresetIndexEntry = {
      id: preset.id,
      name: preset.name,
      tags: preset.tags,
      updatedAt: preset.updatedAt,
    };
    const existing = index.findIndex((e) => e.id === preset.id);
    if (existing >= 0) index[existing] = entry;
    else index.push(entry);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(PRESET_KEY_PREFIX + id);
    const index = (await this.list()).filter((e) => e.id !== id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }
}

export const presetStorage: PresetStorage = new LocalPresetStorage();
