/**
 * Byte-level primitives shared by protocol handlers.
 * Ported from devicePEQ helper functions (byte order semantics preserved).
 */

/** Big-endian split of an unsigned 16-bit value → [high, low]. */
export function splitUnsignedValue(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/** Little-endian byte pair of a (possibly negative) 16-bit value → [low, high]. */
export function toBytePair(value: number): [number, number] {
  return [value & 0xff, (value & 0xff00) >> 8];
}

/** Combine two bytes big-endian: (low << 8) | high — matches FiiO wire order. */
export function combineBytes(highByte: number, lowByte: number): number {
  return (highByte << 8) | lowByte;
}

/**
 * FiiO gain encoding: value ×10, negative values two's-complement style
 * (abs XOR 0xFFFF + 1), big-endian [high, low].
 */
export function fiioGainBytesFromValue(gainDb: number): [number, number] {
  let t = Math.round(gainDb * 10);
  if (t < 0) t = (Math.abs(t) ^ 0xffff) + 1;
  return [(t >> 8) & 0xff, t & 0xff];
}

/** Inverse of fiioGainBytesFromValue: two bytes → signed dB (÷10). */
export function fiioGainValueFromBytes(highByte: number, lowByte: number): number {
  let r = combineBytes(highByte, lowByte);
  if (r & 0x8000) {
    r = (r ^ 0xffff) + 1;
    return -r / 10;
  }
  return r / 10;
}

/** Simple additive checksum (& 0xFF) used by several serial protocols. */
export function checksum8(bytes: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum & 0xff;
}
