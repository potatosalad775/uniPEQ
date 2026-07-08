/**
 * Preset → device-constraints adaptation engine.
 * Pure function: never mutates the preset; returns an adapted EqState plus a
 * structured, renderable diff and a loss score (0 = perfect fit).
 */
import type { EqState, Filter, FilterType, PeqConstraints, PeqPreset } from '../model/types';
import { computeAutoPregain } from '../math/biquad';

export type AdaptationChangeKind =
  | 'type-converted'
  | 'filter-dropped'
  | 'filters-merged'
  | 'gain-clamped'
  | 'q-clamped'
  | 'freq-clamped'
  | 'freq-snapped'
  | 'pregain-clamped'
  | 'pregain-device-managed';

export interface AdaptationChange {
  kind: AdaptationChangeKind;
  /** Index into the ORIGINAL preset filter list (undefined for pregain changes). */
  bandIndex?: number;
  message: string;
  /** Rough dB-scale severity contribution used for lossScore. */
  loss: number;
}

export interface AdaptationResult {
  adapted: EqState;
  changes: AdaptationChange[];
  lossScore: number;
}

function typeSupported(type: FilterType, c: PeqConstraints): boolean {
  switch (type) {
    case 'PK': return true;
    case 'LSQ': return c.supportsLSFilter;
    case 'HSQ': return c.supportsHSFilter;
    case 'LPF': return c.supportsLPFilter === true;
    case 'HPF': return c.supportsHPFilter === true;
    case 'BPF': return c.supportsBPFilter === true;
    case 'NOTCH': return c.supportsNotchFilter === true;
    case 'APF': return c.supportsAllPassFilter === true;
    case 'BSF': return c.supportsBandStopFilter === true;
    case 'CQ': return c.supportsConstantQFilter === true;
  }
}

function describeBand(f: Filter): string {
  const freq = f.freq >= 1000 ? `${(f.freq / 1000).toFixed(1)} kHz` : `${Math.round(f.freq)} Hz`;
  const gain = `${f.gain >= 0 ? '+' : ''}${f.gain} dB`;
  return `${freq}, ${gain}`;
}

interface WorkingFilter extends Filter {
  originalIndex: number;
}

export function adaptPresetToConstraints(preset: PeqPreset, c: PeqConstraints): AdaptationResult {
  const changes: AdaptationChange[] = [];
  let working: WorkingFilter[] = preset.filters.map((f, i) => ({ ...f, originalIndex: i }));

  // 1. Filter-type conversion.
  working = working.flatMap((f) => {
    if (typeSupported(f.type, c)) return [f];
    if (f.type === 'LSQ' || f.type === 'HSQ') {
      // Approximate an unsupported shelf as a peak at the shelf corner.
      changes.push({
        kind: 'type-converted',
        bandIndex: f.originalIndex,
        message: `Band ${f.originalIndex + 1} (${describeBand(f)}): ${f.type === 'LSQ' ? 'low shelf' : 'high shelf'} not supported — converted to peaking`,
        loss: Math.abs(f.gain) * 0.5,
      });
      return [{ ...f, type: 'PK' as FilterType }];
    }
    // No honest PK equivalent for LP/HP/BP/Notch/AP/BS/CQ — drop with warning.
    changes.push({
      kind: 'filter-dropped',
      bandIndex: f.originalIndex,
      message: `Band ${f.originalIndex + 1} (${describeBand(f)}): filter type ${f.type} not supported — dropped`,
      loss: Math.max(Math.abs(f.gain), 3),
    });
    return [];
  });

  // 2a. Merge near-duplicate center frequencies (within 1/3 octave, same type)
  //     before dropping bands — only when over the band budget.
  if (working.filter((f) => f.enabled).length > c.maxFilters) {
    const merged: WorkingFilter[] = [];
    for (const f of working) {
      const partner = merged.find(
        (m) =>
          m.enabled && f.enabled &&
          m.type === f.type && m.type === 'PK' &&
          Math.abs(Math.log2(m.freq / f.freq)) <= 1 / 3,
      );
      if (partner) {
        changes.push({
          kind: 'filters-merged',
          bandIndex: f.originalIndex,
          message: `Band ${f.originalIndex + 1} (${describeBand(f)}) merged into band ${partner.originalIndex + 1} (nearby frequency)`,
          loss: Math.abs(f.gain) * 0.25,
        });
        partner.gain = Math.round((partner.gain + f.gain) * 10) / 10;
      } else {
        merged.push({ ...f });
      }
    }
    working = merged;
  }

  // 2b. Band reduction: drop disabled bands first, then lowest |gain|.
  if (working.length > c.maxFilters) {
    const disabled = working.filter((f) => !f.enabled);
    for (const f of disabled) {
      if (working.length <= c.maxFilters) break;
      working = working.filter((w) => w !== f);
      changes.push({
        kind: 'filter-dropped',
        bandIndex: f.originalIndex,
        message: `Band ${f.originalIndex + 1} (${describeBand(f)}, disabled) dropped — device supports ${c.maxFilters} bands`,
        loss: 0,
      });
    }
    while (working.length > c.maxFilters) {
      const weakest = [...working].sort((a, b) => Math.abs(a.gain) - Math.abs(b.gain))[0];
      working = working.filter((w) => w !== weakest);
      changes.push({
        kind: 'filter-dropped',
        bandIndex: weakest.originalIndex,
        message: `Band ${weakest.originalIndex + 1} (${describeBand(weakest)}) dropped — device supports ${c.maxFilters} bands`,
        loss: Math.abs(weakest.gain),
      });
    }
  }

  // 3. Range clamping (gain, Q, freq, snap table).
  const minFreq = c.minFreq ?? 20;
  const maxFreq = c.maxFreq ?? 20000;
  working = working.map((f) => {
    const out = { ...f };
    if (out.gain < c.minGain || out.gain > c.maxGain) {
      const clamped = Math.min(Math.max(out.gain, c.minGain), c.maxGain);
      changes.push({
        kind: 'gain-clamped',
        bandIndex: f.originalIndex,
        message: `Band ${f.originalIndex + 1}: gain ${out.gain >= 0 ? '+' : ''}${out.gain} dB → ${clamped >= 0 ? '+' : ''}${clamped} dB`,
        loss: Math.abs(out.gain - clamped),
      });
      out.gain = clamped;
    }
    if (out.q < c.minQ || out.q > c.maxQ) {
      const clamped = Math.min(Math.max(out.q, c.minQ), c.maxQ);
      changes.push({
        kind: 'q-clamped',
        bandIndex: f.originalIndex,
        message: `Band ${f.originalIndex + 1}: Q ${out.q} → ${clamped}`,
        loss: Math.abs(Math.log2(Math.max(out.q, 1e-3) / clamped)),
      });
      out.q = clamped;
    }
    if (out.freq < minFreq || out.freq > maxFreq) {
      const clamped = Math.min(Math.max(out.freq, minFreq), maxFreq);
      changes.push({
        kind: 'freq-clamped',
        bandIndex: f.originalIndex,
        message: `Band ${f.originalIndex + 1}: frequency ${out.freq} Hz → ${clamped} Hz`,
        loss: Math.abs(Math.log2(out.freq / clamped)) * 2,
      });
      out.freq = clamped;
    }
    if (c.freqSnapTable && c.freqSnapTable.length > 0) {
      const nearest = c.freqSnapTable.reduce((best, cand) =>
        Math.abs(Math.log2(cand / out.freq)) < Math.abs(Math.log2(best / out.freq)) ? cand : best,
      );
      if (nearest !== out.freq) {
        changes.push({
          kind: 'freq-snapped',
          bandIndex: f.originalIndex,
          message: `Band ${f.originalIndex + 1}: frequency ${out.freq} Hz snapped to ${nearest} Hz`,
          loss: Math.abs(Math.log2(out.freq / nearest)),
        });
        out.freq = nearest;
      }
    }
    return out;
  });

  const filters: Filter[] = working.map(({ originalIndex: _originalIndex, ...f }) => f);

  // 4. Pregain.
  let pregain = preset.pregain === 'auto' ? computeAutoPregain(filters) : preset.pregain;
  if (c.deviceHandlesPregain) {
    if (preset.pregain !== 'auto' && preset.pregain !== 0) {
      changes.push({
        kind: 'pregain-device-managed',
        message: `Manual pregain ${pregain} dB dropped — device manages pregain itself`,
        loss: 0,
      });
    }
    pregain = 0;
  } else if (pregain < c.minGain || pregain > c.maxGain) {
    const clamped = Math.min(Math.max(pregain, c.minGain), c.maxGain);
    changes.push({
      kind: 'pregain-clamped',
      message: `Pregain ${pregain} dB → ${clamped} dB`,
      loss: Math.abs(pregain - clamped),
    });
    pregain = clamped;
  }

  const lossScore = Math.round(changes.reduce((sum, ch) => sum + ch.loss, 0) * 100) / 100;
  return { adapted: { filters, pregain }, changes, lossScore };
}
