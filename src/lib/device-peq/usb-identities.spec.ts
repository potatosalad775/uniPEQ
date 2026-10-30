import { describe, expect, it } from 'vitest';
import { hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { DS3_USB } from './__fixtures__/ds3';
import { usbIdentities } from './usb-identities';

const ds3 = { ...hardwareProfile('fosi-audio-ds3', { bandCount: 32 }), match: { usb: DS3_USB } };
const uac2 = { vendorId: 0x152a, productId: 0x889b, productName: 'Fosi Audio DS3' };
const uac1 = { vendorId: 0x20b1, productId: 0x80d5, productName: 'Fosi Audio DS3' };

describe('usbIdentities', () => {
	it('puts the identity it connected as first, then the others its profile lists', () => {
		const now = { vendorId: '0x20b1', productId: '0x80d5', productName: 'Fosi Audio DS3' };
		expect(usbIdentities(now, ds3)).toEqual([uac1, uac2]);
	});

	it('leaves out entries that stand for a family rather than one identity', () => {
		expect(usbIdentities(undefined, ds3)).toEqual([uac2, uac1]);
	});

	it('expands entries that list several values', () => {
		const profile = {
			...ds3,
			match: { usb: [{ vendorId: '0x0001', productId: ['0x0002', '0x0003'], productName: 'X' }] }
		};
		expect(usbIdentities(undefined, profile).map((i) => i.productId)).toEqual([2, 3]);
	});

	it('is only the device itself for a profile without a match', () => {
		const usb = { vendorId: '0x0001', productId: '0x0002', productName: 'X' };
		expect(usbIdentities(usb, hardwareProfile('dac', { bandCount: 8 }))).toEqual([
			{ vendorId: 1, productId: 2, productName: 'X' }
		]);
	});
});
