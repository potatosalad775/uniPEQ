// Adapted from modernGraphTool src/lib/device-peq/types.ts @ 23ddc4dd.
/**
 * Device PEQ types: the app's view of a connected EQ device.
 *
 * USB HID, USB / Bluetooth serial and BLE devices are driven by `@potatosalad775/eqcaps-device-bridge`
 * and described by their eqcaps profile, over the browser's WebHID / Web Serial / Web Bluetooth or
 * the Android DeviceIo plugin. The UI never needs to know which. (modernGraphTool's network devices
 * are left out for now.)
 */
import type { Profile } from '@potatosalad775/eqcaps-core';
import type {
	DeviceCapabilities,
	DeviceIdentity,
	PullRequest,
	PullResult,
	PushRequest,
	PushResult
} from '@potatosalad775/eqcaps-device-bridge';

export type { PullResult, PushRequest, PushResult, DeviceIdentity };

/** Connection type for device communication */
export type ConnectionType = 'hid' | 'serial' | 'ble';

/** What a device can do: the bridge's capability flags, minus what only the bridge reads. */
export type PeqCapabilities = Pick<
	DeviceCapabilities,
	| 'canRead'
	| 'canWrite'
	| 'readsPreamp'
	| 'readsSlot'
	| 'writesPreamp'
	| 'writesSlot'
	| 'readsCurrentSlot'
	| 'readsEnabled'
	| 'canEnable'
	| 'slots'
	| 'disconnectOnSave'
	| 'experimental'
>;

/**
 * A connected device. The bridge's `BridgeDevice` satisfies this as is. Every value in and out is a
 * written value in eqcaps units (Hz, dB, RBJ Q, `LSC`/`HSC`); pushes are `fit` + `complete`d
 * first, since the bridge never clamps or pads (`push-plan.ts`).
 */
export interface PeqDevice {
	readonly capabilities: PeqCapabilities;
	pull(request?: PullRequest): Promise<PullResult>;
	push(request: PushRequest): Promise<PushResult>;
	/**
	 * The active preset slot; null when the protocol can't say, or on some bypass-preset protocols
	 * when the EQ is off. Where the EQ switch is its own state (`readsEnabled`), the preset whether
	 * the EQ is on or off.
	 */
	currentSlot(): Promise<number | null>;
	/** Whether the EQ is on (`readsEnabled`); null when the protocol or device doesn't say. */
	eqEnabled(): Promise<boolean | null>;
	setEnabled(enabled: boolean, slot?: number): Promise<void>;
	close(): Promise<void>;
}

/**
 * How sure we are about what the device accepts.
 *
 * - `device`: its own eqcaps profile.
 * - `group`: a profile for a family of devices its identity can't tell apart (a chipset scheme).
 * - `guess`: no profile; the vendor's usual protocol, with limits from what that protocol's write
 *   frames can carry. Experimental.
 * - `demo`: the simulated demo device and its app-local profile, which eqcaps doesn't list.
 */
export type ProfileSource = 'device' | 'group' | 'guess' | 'demo';

export interface DeviceConnection {
	device: PeqDevice;
	connectionType: ConnectionType;
	/** "FiiO KA17", or the USB product name for a guessed device. */
	name: string;
	/** What the device accepts. Always present: a guessed device gets one from its protocol. */
	profile: Profile;
	profileSource: ProfileSource;
	/** The eqcaps id of `profile`, when it came from the database (or the demo's own id). */
	profileId: string | null;
	/** What the device reported about itself, for an issue report. */
	identity: DeviceIdentity;
	/**
	 * Re-open the same device without a chooser, after it dropped (USB HID only). With `wait`, for
	 * a device restarting to save: the handle it had is skipped, and it gets until the timeout to
	 * come back. Null if it isn't there (or, on the web, no longer granted).
	 */
	reopen?: (wait?: ReopenWait) => Promise<DeviceConnection | null>;
	/** Android: the plugin's path for the device (changes on every replug), to tell its detach. */
	usbDeviceName?: string;
}

/**
 * Something the user picks to go on connecting: a profile, when a device's identity matched several
 * or none (serial ports), or on Android a device, when several attached ones could be driven.
 */
export interface DeviceCandidate {
	id: string;
	label: string;
}

/** How `reopen` waits for a device that restarts to save. */
export interface ReopenWait {
	timeoutMs: number;
	/** The browser (or Android) saw the device leave or come back, or kept it; for the log. */
	onEvent?: (event: 'connect' | 'disconnect' | 'gone' | 'reused') => void;
}
