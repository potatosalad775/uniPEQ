/**
 * The USB identities a connected device can come back as after it restarts. Some change with a
 * setting (the Fosi DS3 is 0x152a:0x889b in UAC 2.0 and 0x20b1:0x80d5 in UAC 1.0), so reopening
 * looks for each exact identity its profile lists, the one it was connected as first. Entries
 * without a product id or name stand for a family, not this device, and are left out.
 */
import { expandUsbMatch, type Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceIdentity } from './types';

export interface UsbIdentity {
	vendorId: number;
	productId: number;
	productName: string;
}

export function usbIdentities(usb: DeviceIdentity['usb'], profile: Profile): UsbIdentity[] {
	const listed = (profile.match?.usb ?? []).flatMap(expandUsbMatch);
	const all: UsbIdentity[] = [];
	for (const e of [...(usb ? [usb] : []), ...listed]) {
		if (e.productId === undefined || e.productName === undefined) continue;
		const id = {
			vendorId: parseInt(e.vendorId, 16),
			productId: parseInt(e.productId, 16),
			productName: e.productName
		};
		if (!all.some((x) => sameUsb(x, id))) all.push(id);
	}
	return all;
}

export const sameUsb = (a: UsbIdentity, b: UsbIdentity) =>
	a.vendorId === b.vendorId && a.productId === b.productId && a.productName === b.productName;
