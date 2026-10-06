import { describe, expect, it } from 'vitest';
import {
  checksum8,
  combineBytes,
  fiioGainBytesFromValue,
  fiioGainValueFromBytes,
  splitUnsignedValue,
  toBytePair,
} from '@/core/codec/bytes';

describe('codec/bytes', () => {
  it('splitUnsignedValue is big-endian', () => {
    expect(splitUnsignedValue(1000)).toEqual([0x03, 0xe8]);
    expect(splitUnsignedValue(0)).toEqual([0, 0]);
    expect(splitUnsignedValue(0xffff)).toEqual([0xff, 0xff]);
  });

  it('toBytePair is little-endian', () => {
    expect(toBytePair(1000)).toEqual([0xe8, 0x03]);
  });

  it('combineBytes inverts splitUnsignedValue', () => {
    const [hi, lo] = splitUnsignedValue(12345);
    expect(combineBytes(hi, lo)).toBe(12345);
  });

  it('fiio gain roundtrips for positive, negative and fractional values', () => {
    for (const gain of [0, 1, -1, 12, -12, 5.5, -7.3, -24]) {
      const [hi, lo] = fiioGainBytesFromValue(gain);
      expect(fiioGainValueFromBytes(hi, lo)).toBeCloseTo(gain, 5);
    }
  });

  it('fiio gain encoding matches known devicePEQ bytes', () => {
    // -3 dB → -30 → (30 ^ 0xFFFF) + 1 = 0xFFE2 → [0xFF, 0xE2]
    expect(fiioGainBytesFromValue(-3)).toEqual([0xff, 0xe2]);
    // +2 dB → 20 → [0x00, 0x14]
    expect(fiioGainBytesFromValue(2)).toEqual([0x00, 0x14]);
  });

  it('checksum8 sums modulo 256', () => {
    expect(checksum8([1, 2, 3])).toBe(6);
    expect(checksum8([0xff, 0x02])).toBe(1);
  });
});
