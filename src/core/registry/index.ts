/**
 * Device registry: loads devices/**.json (profiles, brand defaults, device
 * files), validates them, and resolves merged device profiles.
 *
 * Merge order (later wins):
 *   constraint profile → brand defaults → device file → device constraintsOverride
 */
import type {
  BrandFile,
  DeviceFile,
  MatchBlock,
  ModelConfig,
  PeqConstraints,
  ProfileFile,
  ResolvedDeviceProfile,
  Slot,
} from '../model/types';
import { validateBrandFile, validateDeviceFile, validateProfileFile } from './validate';

export interface RegistrySource {
  /** path (e.g. "/devices/fiio/ka17.json") → parsed JSON module default export */
  [path: string]: unknown;
}

export class DeviceRegistry {
  readonly profiles = new Map<string, ProfileFile>();
  readonly brands = new Map<string, BrandFile>();
  readonly devices = new Map<string, DeviceFile>();
  /** brand folder name per device id, for brand-default lookup */
  private deviceBrandDir = new Map<string, string>();

  constructor(source: RegistrySource) {
    const errors: string[] = [];
    for (const [path, raw] of Object.entries(source)) {
      const json = (raw as { default?: unknown }).default ?? raw;
      const parts = path.replace(/^\//, '').split('/'); // devices/<dir>/<file>.json
      if (parts.length < 3 || parts[0] !== 'devices') continue;
      const dir = parts[1];
      const file = parts[parts.length - 1];
      if (dir === '_schema') continue;
      try {
        if (dir === '_profiles') {
          const profile = validateProfileFile(json, path);
          this.profiles.set(profile.id, profile);
        } else if (file === '_brand.json') {
          const brand = validateBrandFile(json, path);
          this.brands.set(dir, brand);
        } else {
          const device = validateDeviceFile(json, path);
          this.devices.set(device.id, device);
          this.deviceBrandDir.set(device.id, dir);
        }
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`Device DB validation failed:\n${errors.join('\n')}`);
    }
    // Cross-checks after all files are loaded.
    for (const [id, device] of this.devices) {
      const brand = this.brands.get(this.deviceBrandDir.get(id)!);
      const constraintsRef = device.constraintsRef ?? brand?.defaults?.constraintsRef;
      if (!constraintsRef || !this.profiles.has(constraintsRef)) {
        throw new Error(`Device ${id}: constraintsRef "${constraintsRef}" does not resolve to a profile`);
      }
      const handlerId = device.handlerId ?? brand?.defaults?.handlerId;
      if (!handlerId) {
        throw new Error(`Device ${id}: no handlerId (device file or brand defaults)`);
      }
    }
  }

  resolve(deviceId: string): ResolvedDeviceProfile {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Unknown device id: ${deviceId}`);
    const brandDir = this.deviceBrandDir.get(deviceId)!;
    const brand = this.brands.get(brandDir);
    const defaults = brand?.defaults ?? {};

    const constraintsRef = device.constraintsRef ?? defaults.constraintsRef!;
    const profile = this.profiles.get(constraintsRef)!;
    const constraints: PeqConstraints = {
      ...profile.peqConstraints,
      ...(device.constraintsOverride ?? {}),
    };

    const modelConfig: ModelConfig = {
      ...(defaults.modelConfig ?? {}),
      ...(device.modelConfig ?? {}),
    };
    modelConfig.availableSlots = this.resolveSlots(modelConfig.availableSlots, brand);

    const match: MatchBlock = { ...(device.match ?? {}) };
    if (match.usb && !match.usb.vendorIds && defaults.usb?.vendorIds) {
      match.usb = { ...match.usb, vendorIds: defaults.usb.vendorIds };
    }

    return {
      id: device.id,
      name: device.name,
      brand: device.brand ?? brand?.brand ?? brandDir,
      handlerId: device.handlerId ?? defaults.handlerId!,
      transports: device.transports ?? defaults.transports ?? ['usb-hid'],
      match,
      constraints,
      modelConfig,
      extras: { ...(profile.extras ?? {}), ...(device.extras ?? {}) },
      status: device.status ?? 'experimental',
    };
  }

  /** Expand "$sharedSlotSet" string refs against the brand's sharedSlotSets. */
  private resolveSlots(slots: unknown, brand?: BrandFile): Slot[] {
    if (!Array.isArray(slots)) return [];
    const out: Slot[] = [];
    for (const entry of slots) {
      if (typeof entry === 'string' && entry.startsWith('$')) {
        const set = brand?.sharedSlotSets?.[entry.slice(1)];
        if (!set) throw new Error(`Slot set ref ${entry} not found in brand ${brand?.brand}`);
        out.push(...set);
      } else {
        out.push(entry as Slot);
      }
    }
    return out;
  }

  allResolved(): ResolvedDeviceProfile[] {
    return [...this.devices.keys()].map((id) => this.resolve(id));
  }

  /** Match a USB HID device (vendorId/productId/productName) → candidate profiles. */
  matchUsb(vendorId: number, productId: number, productName?: string): ResolvedDeviceProfile[] {
    const candidates: { profile: ResolvedDeviceProfile; score: number }[] = [];
    for (const profile of this.allResolved()) {
      const usb = profile.match.usb;
      if (!usb) continue;
      let score = 0;
      if (usb.productNames && productName) {
        if (usb.productNames.some((n) => n.toLowerCase() === productName.toLowerCase())) score += 4;
        else if (usb.vendorIds || usb.productIds) score -= 1; // name mismatch but ids may still match
        else continue;
      }
      if (usb.vendorIds) {
        if (!usb.vendorIds.includes(vendorId)) continue;
        score += 1;
      }
      if (usb.productIds) {
        if (!usb.productIds.includes(productId)) continue;
        score += 2;
      }
      if (score > 0) candidates.push({ profile, score });
    }
    return candidates.sort((a, b) => b.score - a.score).map((c) => c.profile);
  }

  matchDemo(): ResolvedDeviceProfile[] {
    return this.allResolved().filter((p) => p.match.demo === true);
  }
}

let defaultRegistry: DeviceRegistry | undefined;

/** Registry compiled from devices/**.json at build time (works offline). */
export function getRegistry(): DeviceRegistry {
  if (!defaultRegistry) {
    const modules = import.meta.glob('/devices/**/*.json', { eager: true });
    defaultRegistry = new DeviceRegistry(modules);
  }
  return defaultRegistry;
}
