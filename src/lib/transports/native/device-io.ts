/**
 * Typings for the `DeviceIo` Capacitor plugin (native/device-io, Kotlin). Bytes cross the bridge
 * as base64; rejections carry code `transport`. Android only: on the web every call rejects
 * with "not implemented".
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeUsbDevice {
	/** Android's device path, e.g. `/dev/bus/usb/001/002`. Changes on every replug. */
	deviceName: string;
	vendorId: number;
	productId: number;
	productName: string;
	manufacturerName: string;
	hasPermission: boolean;
	hidInterfaces: number[];
}

export interface NativeHidInterface {
	number: number;
	/** `claimInterface(force = true)` succeeded. */
	claimed: boolean;
	endpoints: number;
	/** Base64; absent when the claim or GET_DESCRIPTOR failed. */
	reportDescriptor?: string;
}

export interface DeviceIoPlugin {
	list(): Promise<{ devices: NativeUsbDevice[] }>;
	requestPermission(options: { deviceName: string }): Promise<{ granted: boolean }>;
	describe(options: { deviceName: string }): Promise<{ interfaces: NativeHidInterface[] }>;
	open(options: {
		deviceName: string;
		interfaceNumber: number;
	}): Promise<{ handle: number; inputEndpoint: boolean; outputEndpoint: boolean }>;
	/** `data` excludes the report id; the plugin prepends it on numbered reports. */
	sendReport(options: { handle: number; reportId: number; data: string }): Promise<void>;
	sendFeatureReport(options: { handle: number; reportId: number; data: string }): Promise<void>;
	/** As the device answers: report id first on numbered reports. */
	receiveFeatureReport(options: {
		handle: number;
		reportId: number;
		length: number;
	}): Promise<{ data: string }>;
	close(options: { handle: number }): Promise<void>;
	/** Raw interrupt IN packets: report id first on numbered reports. */
	addListener(
		event: 'inputReport',
		listener: (e: { handle: number; data: string }) => void
	): Promise<PluginListenerHandle>;
	addListener(
		event: 'deviceAttached',
		listener: (e: { device: NativeUsbDevice }) => void
	): Promise<PluginListenerHandle>;
	addListener(
		event: 'deviceDetached',
		listener: (e: { deviceName: string }) => void
	): Promise<PluginListenerHandle>;
}

export const DeviceIo = registerPlugin<DeviceIoPlugin>('DeviceIo');
