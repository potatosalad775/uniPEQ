/**
 * Web discovery/permission layer. Browser rule: requestDevice must run inside
 * a user gesture; previously-granted devices can be listed passively.
 */
import type { ResolvedDeviceProfile } from '@/core/model/types';
import { DeviceRegistry } from '@/core/registry';

export interface DiscoveredHidDevice {
  device: HIDDevice;
  candidates: ResolvedDeviceProfile[];
}

export function webHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

function matchCandidates(registry: DeviceRegistry, device: HIDDevice): ResolvedDeviceProfile[] {
  return registry.matchUsb(device.vendorId, device.productId, device.productName);
}

/** All previously-authorized HID devices that match something in the DB. */
export async function listGrantedHidDevices(registry: DeviceRegistry): Promise<DiscoveredHidDevice[]> {
  if (!webHidSupported()) return [];
  const devices = await navigator.hid.getDevices();
  return devices
    .map((device) => ({ device, candidates: matchCandidates(registry, device) }))
    .filter((d) => d.candidates.length > 0);
}

/** Opens the browser chooser (must be called from a user gesture). */
export async function requestHidDevice(registry: DeviceRegistry): Promise<DiscoveredHidDevice | undefined> {
  if (!webHidSupported()) throw new Error('WebHID is not supported in this browser');
  const vendorIds = new Set<number>();
  for (const profile of registry.allResolved()) {
    for (const vid of profile.match.usb?.vendorIds ?? []) vendorIds.add(vid);
  }
  const filters = [...vendorIds].map((vendorId) => ({ vendorId }));
  const devices = await navigator.hid.requestDevice({ filters });
  if (devices.length === 0) return undefined;
  return { device: devices[0], candidates: matchCandidates(registry, devices[0]) };
}
