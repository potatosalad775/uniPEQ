/**
 * Android USB HID as an eqcaps bridge `HidTransport`, over the DeviceIo plugin. Handlers can't
 * tell it from the bridge's WebHID transport (eqcaps D27): same report-id conventions (ids
 * stripped from input and output data, kept on feature reads), same `BridgeError('transport')`.
 */
import { BridgeError, type HidTransport } from '@potatosalad775/eqcaps-device-bridge';
import { DeviceIo, type DeviceIoPlugin, type NativeUsbDevice } from './device-io';
import { parseReportDescriptor, type ParsedReportDescriptor } from './hid-report-descriptor';

export type { NativeUsbDevice } from './device-io';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

const transportError =
	(what: string) =>
	(cause: unknown): never => {
		throw new BridgeError('transport', `DeviceIo: ${what} failed`, { cause });
	};

/** Zero-pads to the descriptor's report size, as WebHID does on Windows and macOS. */
function padded(data: Uint8Array, size: number | undefined): Uint8Array {
	if (size === undefined || data.length >= size) return data;
	const out = new Uint8Array(size);
	out.set(data);
	return out;
}

export async function listNativeHidDevices(
	plugin: DeviceIoPlugin = DeviceIo
): Promise<NativeUsbDevice[]> {
	const { devices } = await plugin.list().catch(transportError('list'));
	return devices;
}

/**
 * Asks for USB permission if needed, reads the HID interfaces' report descriptors and opens the
 * one with a vendor-defined collection (as the bridge's `requestHidDevice` prefers), else the
 * first readable one.
 */
export async function openNativeHid(
	device: NativeUsbDevice,
	plugin: DeviceIoPlugin = DeviceIo
): Promise<HidTransport> {
	const { deviceName } = device;
	if (!device.hasPermission) {
		const { granted } = await plugin
			.requestPermission({ deviceName })
			.catch(transportError('requestPermission'));
		if (!granted)
			throw new BridgeError('transport', `USB permission denied for ${device.productName}`);
	}
	const { interfaces } = await plugin.describe({ deviceName }).catch(transportError('describe'));
	const readable = interfaces.flatMap((i) =>
		i.reportDescriptor
			? [{ number: i.number, descriptor: parseReportDescriptor(fromBase64(i.reportDescriptor)) }]
			: []
	);
	const chosen =
		readable.find((i) => i.descriptor.collections.some((c) => c.usagePage >= 0xff00)) ??
		readable[0];
	if (!chosen) {
		throw new BridgeError(
			'transport',
			`DeviceIo: no readable HID interface on ${device.productName}`,
			{
				cause: interfaces
			}
		);
	}
	return openInterface(plugin, device, chosen.number, chosen.descriptor);
}

async function openInterface(
	plugin: DeviceIoPlugin,
	device: NativeUsbDevice,
	interfaceNumber: number,
	descriptor: ParsedReportDescriptor
): Promise<HidTransport> {
	const { numbered, sizes } = descriptor;
	const { handle } = await plugin
		.open({ deviceName: device.deviceName, interfaceNumber })
		.catch(transportError('open'));
	const listeners = new Set<(reportId: number, data: Uint8Array) => void>();
	let closed = false;

	const inputSub = await plugin.addListener('inputReport', (e) => {
		if (e.handle !== handle) return;
		const raw = fromBase64(e.data);
		const reportId = numbered ? (raw[0] ?? 0) : 0;
		const data = numbered ? raw.subarray(1) : raw;
		for (const listener of [...listeners]) listener(reportId, data);
	});
	const detachSub = await plugin.addListener('deviceDetached', (e) => {
		if (e.deviceName === device.deviceName) closed = true;
	});

	const live = (what: string) => {
		if (closed)
			throw new BridgeError('transport', `DeviceIo: ${what} on a closed or detached device`);
	};

	return {
		kind: 'hid',
		vendorId: device.vendorId,
		productId: device.productId,
		productName: device.productName,
		collections: descriptor.collections,
		async sendReport(reportId, data) {
			live('sendReport');
			const bytes = toBase64(padded(data, sizes.output.get(reportId)));
			await plugin
				.sendReport({ handle, reportId, data: bytes })
				.catch(transportError('sendReport'));
		},
		async sendFeatureReport(reportId, data) {
			live('sendFeatureReport');
			const bytes = toBase64(padded(data, sizes.feature.get(reportId)));
			await plugin
				.sendFeatureReport({ handle, reportId, data: bytes })
				.catch(transportError('sendFeatureReport'));
		},
		async receiveFeatureReport(reportId) {
			live('receiveFeatureReport');
			const length = (sizes.feature.get(reportId) ?? 64) + (numbered ? 1 : 0);
			const { data } = await plugin
				.receiveFeatureReport({ handle, reportId, length })
				.catch(transportError('receiveFeatureReport'));
			return fromBase64(data);
		},
		onInputReport(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async close() {
			closed = true;
			listeners.clear();
			await Promise.all([inputSub.remove(), detachSub.remove()]);
			await plugin.close({ handle }).catch(transportError('close'));
		}
	};
}
