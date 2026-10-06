import { describe, expect, it } from 'vitest';
import { DeviceRegistry } from '@/core/registry';
import { hasHandler } from '@/core/handlers';

// Same glob the app uses — validates every real device DB file in CI.
const modules = import.meta.glob('/devices/**/*.json', { eager: true });

describe('device DB', () => {
  it('all files validate and cross-references resolve', () => {
    expect(() => new DeviceRegistry(modules)).not.toThrow();
  });

  const registry = new DeviceRegistry(modules);

  it('has profiles, brands and devices', () => {
    expect(registry.profiles.size).toBeGreaterThan(0);
    expect(registry.devices.size).toBeGreaterThan(0);
  });

  it('every handlerId has an implementation', () => {
    for (const profile of registry.allResolved()) {
      expect(hasHandler(profile.handlerId), `handler ${profile.handlerId} for ${profile.id}`).toBe(true);
    }
  });

  it('no duplicate device ids or product-name matches', () => {
    const names = new Map<string, string>();
    for (const profile of registry.allResolved()) {
      for (const name of profile.match.usb?.productNames ?? []) {
        const key = name.toLowerCase();
        expect(names.has(key), `productName "${name}" claimed by ${names.get(key)} and ${profile.id}`).toBe(false);
        names.set(key, profile.id);
      }
    }
  });

  it('resolves KA17 with brand defaults merged under device overrides', () => {
    const ka17 = registry.resolve('fiio/ka17');
    expect(ka17.handlerId).toBe('fiioUsbHid');           // from _brand.json
    expect(ka17.modelConfig.reportId).toBe(1);           // device override beats brand default 7
    expect(ka17.modelConfig.disconnectOnSave).toBe(false);
    expect(ka17.constraints.maxFilters).toBe(10);        // from profile
    expect(ka17.constraints.maxGain).toBe(12);
    expect(ka17.match.usb?.vendorIds).toContain(10610);  // inherited brand vendorIds
  });

  it('expands $sharedSlotSets refs from the brand file', () => {
    // No prototype device uses the ref directly, but brand defaults do.
    const jiezi = registry.resolve('fiio/jadeaudio-jiezi');
    expect(jiezi.modelConfig.availableSlots?.some((s) => s.name === 'Close EQ')).toBe(true);
  });

  it('matches by productName', () => {
    const matches = registry.matchUsb(10610, 147, 'FIIO KA17');
    expect(matches[0]?.id).toBe('fiio/ka17');
  });

  it('demo device is matchable', () => {
    expect(registry.matchDemo().map((p) => p.id)).toContain('demo/demo-dac');
  });
});
