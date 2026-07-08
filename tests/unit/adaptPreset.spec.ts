import { describe, expect, it } from 'vitest';
import { adaptPresetToConstraints } from '@/core/adaptation/adaptPreset';
import type { PeqConstraints, PeqPreset } from '@/core/model/types';

function makePreset(overrides: Partial<PeqPreset> = {}): PeqPreset {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test preset',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pregain: 0,
    filters: [],
    ...overrides,
  };
}

const baseConstraints: PeqConstraints = {
  minGain: -12,
  maxGain: 12,
  maxFilters: 5,
  supportsLSFilter: true,
  supportsHSFilter: true,
  deviceHandlesPregain: false,
  supportsManualGlobalGain: true,
  minQ: 0.1,
  maxQ: 10,
};

describe('adaptation engine', () => {
  it('perfect fit → no changes, lossScore 0', () => {
    const preset = makePreset({
      filters: [{ type: 'PK', freq: 1000, gain: 3, q: 1, enabled: true }],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    expect(result.changes).toEqual([]);
    expect(result.lossScore).toBe(0);
    expect(result.adapted.filters).toHaveLength(1);
  });

  it('converts unsupported shelves to PK', () => {
    const preset = makePreset({
      filters: [{ type: 'LSQ', freq: 100, gain: 4, q: 0.7, enabled: true }],
    });
    const c = { ...baseConstraints, supportsLSFilter: false };
    const result = adaptPresetToConstraints(preset, c);
    expect(result.adapted.filters[0].type).toBe('PK');
    expect(result.changes[0].kind).toBe('type-converted');
    expect(result.lossScore).toBeGreaterThan(0);
  });

  it('drops filter types with no PK equivalent', () => {
    const preset = makePreset({
      filters: [
        { type: 'LPF', freq: 8000, gain: 0, q: 0.7, enabled: true },
        { type: 'PK', freq: 1000, gain: 2, q: 1, enabled: true },
      ],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    expect(result.adapted.filters).toHaveLength(1);
    expect(result.adapted.filters[0].type).toBe('PK');
    expect(result.changes[0].kind).toBe('filter-dropped');
  });

  it('reduces band count: disabled dropped first, then lowest |gain|', () => {
    const preset = makePreset({
      filters: [
        { type: 'PK', freq: 100, gain: 8, q: 1, enabled: true },
        { type: 'PK', freq: 300, gain: -6, q: 1, enabled: true },
        { type: 'PK', freq: 900, gain: 4, q: 1, enabled: true },
        { type: 'PK', freq: 2700, gain: 0.5, q: 1, enabled: true },
        { type: 'PK', freq: 8000, gain: -3, q: 1, enabled: true },
        { type: 'PK', freq: 12000, gain: 5, q: 1, enabled: false },
        { type: 'PK', freq: 16000, gain: 2, q: 1, enabled: true },
      ],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    expect(result.adapted.filters).toHaveLength(5);
    // The disabled 12 kHz band and the weakest (0.5 dB) band are gone.
    expect(result.adapted.filters.find((f) => f.freq === 12000)).toBeUndefined();
    expect(result.adapted.filters.find((f) => f.freq === 2700)).toBeUndefined();
    expect(result.adapted.filters.find((f) => f.freq === 100)).toBeDefined();
  });

  it('merges near-duplicate PK bands before dropping', () => {
    const preset = makePreset({
      filters: [
        { type: 'PK', freq: 1000, gain: 3, q: 1, enabled: true },
        { type: 'PK', freq: 1100, gain: 2, q: 1, enabled: true }, // within 1/3 octave of 1000
        { type: 'PK', freq: 100, gain: 4, q: 1, enabled: true },
        { type: 'PK', freq: 300, gain: 4, q: 1, enabled: true },
        { type: 'PK', freq: 3000, gain: 4, q: 1, enabled: true },
        { type: 'PK', freq: 8000, gain: 4, q: 1, enabled: true },
      ],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    expect(result.adapted.filters).toHaveLength(5);
    const merged = result.adapted.filters.find((f) => f.freq === 1000);
    expect(merged?.gain).toBe(5); // 3 + 2
    expect(result.changes.some((ch) => ch.kind === 'filters-merged')).toBe(true);
  });

  it('clamps gain, Q and frequency', () => {
    const preset = makePreset({
      filters: [{ type: 'PK', freq: 30000, gain: 14, q: 20, enabled: true }],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    const f = result.adapted.filters[0];
    expect(f.gain).toBe(12);
    expect(f.q).toBe(10);
    expect(f.freq).toBe(20000);
    expect(result.changes.map((c) => c.kind).sort()).toEqual(['freq-clamped', 'gain-clamped', 'q-clamped']);
  });

  it('snaps frequency to freqSnapTable', () => {
    const preset = makePreset({
      filters: [{ type: 'PK', freq: 900, gain: 3, q: 1, enabled: true }],
    });
    const c = { ...baseConstraints, freqSnapTable: [125, 250, 500, 1000, 2000] };
    const result = adaptPresetToConstraints(preset, c);
    expect(result.adapted.filters[0].freq).toBe(1000);
    expect(result.changes[0].kind).toBe('freq-snapped');
  });

  it('computes auto pregain from positive peak', () => {
    const preset = makePreset({
      pregain: 'auto',
      filters: [{ type: 'PK', freq: 1000, gain: 6, q: 1, enabled: true }],
    });
    const result = adaptPresetToConstraints(preset, baseConstraints);
    expect(result.adapted.pregain).toBeLessThan(-5.5);
  });

  it('drops manual pregain when device handles it', () => {
    const preset = makePreset({
      pregain: -4,
      filters: [{ type: 'PK', freq: 1000, gain: 3, q: 1, enabled: true }],
    });
    const c = { ...baseConstraints, deviceHandlesPregain: true };
    const result = adaptPresetToConstraints(preset, c);
    expect(result.adapted.pregain).toBe(0);
    expect(result.changes.some((ch) => ch.kind === 'pregain-device-managed')).toBe(true);
  });

  it('never mutates the input preset', () => {
    const preset = makePreset({
      filters: [{ type: 'PK', freq: 30000, gain: 14, q: 20, enabled: true }],
    });
    const copy = JSON.parse(JSON.stringify(preset));
    adaptPresetToConstraints(preset, baseConstraints);
    expect(preset).toEqual(copy);
  });
});
