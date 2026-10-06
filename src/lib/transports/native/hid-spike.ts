/**
 * Phase 0 spike (docs/rebuild-plan.md): find a USB HID device the bridge knows by vendor id,
 * open it over the native transport and run the real eqcaps handler's pull. Not UI: $lib/platform/native.ts
 * exposes it as `window.uniPeqHidSpike` on native builds, driven by scripts/android-hid-spike.mjs
 * or a devtools console.
 */
import { guessProtocol, openDevice } from '@potatosalad775/eqcaps-device-bridge';
import { listNativeHidDevices, openNativeHid } from './native-hid-transport';

export interface HidSpikeOptions {
	/** Band count for protocols that can't read it (walkplay). No profile lookup yet (Phase 2). */
	bands?: number;
	log?: (message: string) => void;
}

export async function runHidSpike({ bands = 8, log = console.log }: HidSpikeOptions = {}) {
	const devices = await listNativeHidDevices();
	log(`USB HID devices: ${JSON.stringify(devices)}`);
	const device = devices.find((d) => guessProtocol(d.vendorId));
	if (!device) throw new Error('No USB HID device with a known vendor id is attached');
	const protocol = guessProtocol(device.vendorId)!;
	log(`Opening ${device.productName} (${protocol.handler})`);

	const transport = await openNativeHid(device);
	const bridge = openDevice(transport, protocol, { profile: { bandCount: bands }, log });
	try {
		const pull = await bridge.pull();
		const slot = await bridge.currentSlot().catch((error: unknown) => {
			log(`currentSlot failed: ${String(error)}`);
			return null;
		});
		return { device, handler: protocol.handler, collections: transport.collections, pull, slot };
	} finally {
		await bridge.close();
	}
}
