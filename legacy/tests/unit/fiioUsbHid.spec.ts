import { describe, expect, it } from 'vitest';
import { fiioUsbHid } from '@/core/handlers/fiioUsbHid';
import { DeviceRegistry } from '@/core/registry';
import type { HandlerContext } from '@/core/transport';
import type { Logger } from '@/core/model/types';
import { MockHidTransport, type Responder } from './mockHidTransport';

const registry = new DeviceRegistry(import.meta.glob('/devices/**/*.json', { eager: true }));
const ka17 = registry.resolve('fiio/ka17');

const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const GET = [0xbb, 0x0b];

/**
 * Simulated KA17: slot 4 active, 2 filters, global gain -3 dB.
 *   filter 0: PK  100 Hz +3.0 dB Q 1.0
 *   filter 1: LSQ 8 kHz -2.5 dB Q 0.7
 */
const ka17Responder: Responder = (_reportId, data) => {
  if (data[0] !== 0xbb) return undefined; // only GET packets get answers
  switch (data[4]) {
    case 0x16: // preset switch
      return [[...GET, 0, 0, 0x16, 1, 4, 0, 0xee]];
    case 0x18: // filter count
      return [[...GET, 0, 0, 0x18, 1, 2, 0, 0xee]];
    case 0x17: // global gain: -3 dB → 0xFFE2
      return [[...GET, 0, 0, 0x17, 2, 0xff, 0xe2, 0, 0xee]];
    case 0x15: {
      const index = data[6];
      if (index === 0) {
        // +3 dB → 30 → [0x00,0x1E]; 100 Hz → [0x00,0x64]; Q 1.00 → [0x00,0x64]; PK
        return [[...GET, 0, 0, 0x15, 8, 0, 0x00, 0x1e, 0x00, 0x64, 0x00, 0x64, 0, 0, 0xee]];
      }
      // -2.5 dB → 0xFFE7; 8000 Hz → [0x1F,0x40]; Q 0.70 → [0x00,0x46]; LSQ (1)
      return [[...GET, 0, 0, 0x15, 8, 1, 0xff, 0xe7, 0x1f, 0x40, 0x00, 0x46, 1, 0, 0xee]];
    }
    default:
      return undefined;
  }
};

function makeCtx(responder: Responder): { ctx: HandlerContext; transport: MockHidTransport } {
  const transport = new MockHidTransport(responder);
  return { ctx: { transport, profile: ka17, log: nullLogger }, transport };
}

describe('fiioUsbHid handler (KA17 fixture)', () => {
  it('getCurrentSlot decodes the active preset', async () => {
    const { ctx, transport } = makeCtx(ka17Responder);
    const slot = await fiioUsbHid.getCurrentSlot(ctx);
    expect(slot).toBe(4);
    // Request must go out on reportId 1 (KA17 override) as a preset GET.
    expect(transport.sent[0]).toEqual({
      reportId: 1,
      data: [0xbb, 0x0b, 0, 0, 0x16, 0, 0, 0xee],
    });
  });

  it('getCurrentSlot maps disabledPresetId to -1', async () => {
    const { ctx } = makeCtx((_, data) =>
      data[4] === 0x16 ? [[...GET, 0, 0, 0x16, 1, 10, 0, 0xee]] : undefined,
    );
    expect(await fiioUsbHid.getCurrentSlot(ctx)).toBe(-1);
  });

  it('pullFromDevice decodes filters and global gain', async () => {
    const { ctx } = makeCtx(ka17Responder);
    const result = await fiioUsbHid.pullFromDevice(ctx, 4);
    expect(result.globalGain).toBe(-3);
    expect(result.filters).toEqual([
      { type: 'PK', freq: 100, gain: 3, q: 1, enabled: true },
      { type: 'LSQ', freq: 8000, gain: -2.5, q: 0.7, enabled: true },
    ]);
  });

  it('pushToDevice emits the exact devicePEQ byte sequence', async () => {
    const { ctx, transport } = makeCtx(() => undefined);
    const result = await fiioUsbHid.pushToDevice(ctx, 4, -3, [
      { type: 'PK', freq: 100, gain: 3, q: 1, enabled: true },
      { type: 'LSQ', freq: 8000, gain: -2.5, q: 0.7, enabled: true },
    ]);

    expect(transport.sent.every((r) => r.reportId === 1)).toBe(true);
    expect(transport.sent.map((r) => r.data)).toEqual([
      // global gain: maxGain(12) + pregain(-3) = 9 dB → 90 → [hi 0, lo 90]
      [0xaa, 0x0a, 0, 0, 0x17, 2, 0, 90, 0, 0xee],
      // filter count 2
      [0xaa, 0x0a, 0, 0, 0x18, 1, 2, 0, 0xee],
      // filter 0: PK 100 Hz +3 dB Q1
      [0xaa, 0x0a, 0, 0, 0x15, 8, 0, 0x00, 0x1e, 0x00, 0x64, 0x00, 0x64, 0, 0, 0xee],
      // filter 1: LSQ 8 kHz -2.5 dB Q0.7
      [0xaa, 0x0a, 0, 0, 0x15, 8, 1, 0xff, 0xe7, 0x1f, 0x40, 0x00, 0x46, 1, 0, 0xee],
      // save to slot 4
      [0xaa, 0x0a, 0, 0, 0x19, 1, 4, 0, 0xee],
    ]);
    expect(result.deviceWillDisconnect).toBe(false); // KA17: disconnectOnSave=false
  });

  it('disabled filters are written with 0 gain to clear device state', async () => {
    const { ctx, transport } = makeCtx(() => undefined);
    await fiioUsbHid.pushToDevice(ctx, 4, 0, [
      { type: 'PK', freq: 100, gain: 3, q: 1, enabled: false },
    ]);
    const filterPacket = transport.sent.find((r) => r.data[4] === 0x15)!;
    expect(filterPacket.data.slice(7, 9)).toEqual([0, 0]); // gain bytes zeroed
  });

  it('enablePEQ(false) switches to the disabled preset', async () => {
    const { ctx, transport } = makeCtx(() => undefined);
    await fiioUsbHid.enablePEQ(ctx, false, 4);
    expect(transport.sent[0].data).toEqual([0xaa, 0x0a, 0, 0, 0x16, 1, 10, 0, 0xee]);
  });
});
