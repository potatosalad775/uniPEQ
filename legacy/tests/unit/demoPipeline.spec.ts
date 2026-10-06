/**
 * End-to-end (no browser) pipeline test: registry → demo handler →
 * DemoTransport, exactly as MainTab drives it.
 */
import { describe, expect, it } from 'vitest';
import { demoHandler } from '@/core/handlers/demo';
import { DeviceRegistry } from '@/core/registry';
import type { HandlerContext } from '@/core/transport';
import type { Logger } from '@/core/model/types';
import { DemoTransport } from '@/transports/demo/demoTransport';

const registry = new DeviceRegistry(import.meta.glob('/devices/**/*.json', { eager: true }));
const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('demo device pipeline', () => {
  it('connect → getSlot → pull → push → pull roundtrip', async () => {
    const profile = registry.resolve('demo/demo-dac');
    const transport = new DemoTransport();
    await transport.open();
    const ctx: HandlerContext = { transport, profile, log: nullLogger };

    expect(await demoHandler.getCurrentSlot(ctx)).toBe(1);

    const initial = await demoHandler.pullFromDevice(ctx, 1);
    expect(initial.filters.length).toBeGreaterThan(0);

    const newFilters = [{ type: 'PK' as const, freq: 500, gain: -4, q: 2, enabled: true }];
    const pushResult = await demoHandler.pushToDevice(ctx, 2, -1.5, newFilters);
    expect(pushResult.deviceWillDisconnect).toBe(false);

    const readBack = await demoHandler.pullFromDevice(ctx, 2);
    expect(readBack.filters).toEqual(newFilters);
    expect(readBack.globalGain).toBe(-1.5);

    // Slot 1 untouched by the slot-2 write.
    const slot1 = await demoHandler.pullFromDevice(ctx, 1);
    expect(slot1.filters).toEqual(initial.filters);

    await transport.close();
  });
});
