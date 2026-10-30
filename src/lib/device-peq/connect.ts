// Adapted from modernGraphTool src/lib/device-peq/connect.ts @ 23ddc4dd: our eqcaps client and
// logger, and `connectNativeHid` for Android next to the browser choosers.
/**
 * Connecting a device: a chooser (the browser's, or on Android the attached USB devices), then the
 * eqcaps database says which device it is (`matchDevice`), what it accepts (its profile) and how
 * to drive it (the profile's `protocol`).
 *
 * Only ever reached through a dynamic `import()`, so neither the bridge nor the client is in the
 * boot bundle.
 */
import type { IndexEntry, Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceMatch } from '@potatosalad775/eqcaps-client';
import {
	analyzeCodec,
	guessProtocol,
	HANDLERS,
	identityOf,
	openDevice,
	protocolForMatches,
	protocolOf,
	transportsOf,
	usbHex,
	type DeviceIdentity,
	type Protocol,
	type Transport
} from '@potatosalad775/eqcaps-device-bridge';
import {
	grantedHidDevice,
	requestBleDevice,
	requestHidDevice,
	requestSerialPort,
	waitForGrantedHidDevice,
	type HidDeviceLike,
	type HidIdentity,
	type HidLike
} from '@potatosalad775/eqcaps-device-bridge/browser';
import * as m from '#lib/paraglide/messages.js';
import { eqcapsClient } from '#lib/services/eqcaps-client.js';
import { logger } from '#lib/services/logger.js';
import {
	DeviceIo,
	type DeviceIoPlugin,
	type NativeUsbDevice
} from '#lib/transports/native/device-io.js';
import {
	listNativeHidDevices,
	openNativeHid
} from '#lib/transports/native/native-hid-transport.js';
import { DEMO_PROFILE, DemoHidTransport, demoDac } from './demo';
import type { DeviceCandidate, DeviceConnection, ProfileSource, ReopenWait } from './types';
import { sameUsb, usbIdentities } from './usb-identities';

export type BridgeConnectionType = 'hid' | 'serial' | 'ble';

/**
 * What a connect attempt came to.
 *
 * - `connected`: open and ready.
 * - `cancelled`: the user closed the browser's chooser.
 * - `choose`: the device's identity fits several profiles (or a Bluetooth serial port, which
 *   names no device at all): the user picks one, then `finish` opens it.
 * - `unsupported`: no profile and no protocol this bridge speaks. `identity` is for an issue.
 * - `no-device`: Android only: no attached USB device is one the database or the bridge knows.
 */
export type ConnectResult =
	| { kind: 'connected'; connection: DeviceConnection }
	| { kind: 'cancelled' }
	| {
			kind: 'choose';
			candidates: DeviceCandidate[];
			finish(id: string): Promise<ConnectResult>;
			cancel(): Promise<void>;
	  }
	| { kind: 'unsupported'; identity: DeviceIdentity }
	| { kind: 'no-device' };

function entryLabel(e: Pick<IndexEntry, 'brand' | 'model' | 'engine'>): string {
	const name = `${e.brand} ${e.model}`;
	return e.engine ? `${name} · ${e.engine}` : name;
}

/**
 * Labels for the profiles a tie offers. Profiles that only the firmware tells apart share a
 * brand and model, so a label that would repeat says which firmware its profile is for.
 */
function candidateLabels(entries: IndexEntry[]): string[] {
	const labels = entries.map(entryLabel);
	return entries.map((e, i) => {
		const fw = e.match?.firmware;
		if (!fw || labels.indexOf(labels[i]) === labels.lastIndexOf(labels[i])) return labels[i];
		const range = [fw.min && `≥ ${fw.min}`, fw.max && `< ${fw.max}`].filter(Boolean).join(', ');
		return m.device_peq_candidate_firmware({ name: labels[i], range });
	});
}

/** Hardware entries a transport kind can drive, for the user to pick from. */
function drivable(entries: IndexEntry[], kind: Transport['kind']): IndexEntry[] {
	return entries.filter((e) => {
		if (e.kind !== 'hardware' || e.status === 'deprecated') return false;
		const p = protocolOf(e);
		return !!p && transportsOf(HANDLERS[p.handler]).includes(kind);
	});
}

/** Matches tied at the top, the ones `matchDevice` refused to choose between. */
function topTies(matches: DeviceMatch<IndexEntry>[]): DeviceMatch<IndexEntry>[] {
	const top = matches[0];
	if (!top) return [];
	return matches.filter((m) => m.specificity === top.specificity && m.group === top.group);
}

/**
 * The device's firmware version, when it can decide the match: a matched profile has a firmware
 * range (the Fosi DS3's 8- and 32-band firmware share one USB identity) and the protocol the top
 * matches share reads one. Only then, since a device that doesn't answer costs the handler's
 * timeout. Null otherwise, or when the device doesn't say.
 */
async function readFirmware(
	matches: DeviceMatch<IndexEntry>[],
	open: (protocol: Protocol) => Promise<Transport>
): Promise<string | null> {
	if (!matches.some((x) => x.entry.match?.firmware)) return null;
	const protocols = topTies(matches).map(
		(x) => protocolOf(x.entry) ?? protocolForMatches(matches)?.protocol
	);
	const protocol = protocols[0];
	if (!protocol || protocols.some((p) => p?.handler !== protocol.handler)) return null;
	try {
		const device = openDevice(await open(protocol), protocol, {
			log: (message) => logger.debug(message)
		});
		return device.capabilities.readsFirmware ? await device.firmware() : null;
	} catch (e) {
		logger.debug(`no firmware version: ${(e as Error).message}`);
		return null;
	}
}

/**
 * Limits for a device with no profile: what its protocol's write frames can carry
 * (`analyzeCodec`), so a push never asks for a value the wire would refuse. The band count is the
 * protocol's own when it fixes one, else ten.
 */
export function guessedProfile(protocol: Protocol, name: string): Profile {
	const a = analyzeCodec(protocol);
	const bandCount = a.bands.min === a.bands.max ? a.bands.min : Math.min(10, a.bands.max);
	const types = a.types.filter((t) => t === 'PK' || t === 'LSC' || t === 'HSC');
	return {
		schemaVersion: '1.0',
		id: `guess-${protocol.handler}`,
		kind: 'hardware',
		device: { brand: name, model: '' },
		bandCount: Math.max(1, bandCount),
		band: {
			types: types.length ? types : ['PK'],
			freq: a.freq ?? { min: 20, max: 20000 },
			q: a.q ?? { min: 0.1, max: 10 },
			gain: a.gain ?? { min: -12, max: 12 }
		},
		preamp: a.preamp ? { mode: 'manual', gain: a.preamp } : { mode: 'unknown' },
		meta: { status: 'draft', sources: [] }
	};
}

interface Resolved {
	protocol: Protocol;
	profile: Profile;
	profileSource: ProfileSource;
	profileId: string | null;
	name: string;
}

/**
 * The protocol and profile for a chosen profile id, or for the best of `matches`. The protocol
 * comes from the most specific match that has one (a device profile under a group profile is
 * driven by the group's); the limits from the chosen profile itself.
 */
async function resolve(
	matches: DeviceMatch<IndexEntry>[],
	chosen: IndexEntry | null,
	fallbackName: string,
	vendorId: number | null
): Promise<Resolved | null> {
	const client = eqcapsClient();
	const protocol =
		(chosen && protocolOf(chosen)) ??
		protocolForMatches(chosen ? [{ id: chosen.id, entry: chosen }, ...matches] : matches)?.protocol;
	if (chosen && protocol) {
		const profile = await client.loadProfile(chosen.id);
		if (profile) {
			return {
				protocol,
				profile,
				profileSource: chosen.group ? 'group' : 'device',
				profileId: chosen.id,
				name: entryLabel(chosen)
			};
		}
		// Index reachable, profile not: drive it on its protocol with the protocol's own limits.
		return {
			protocol,
			profile: guessedProfile(protocol, entryLabel(chosen)),
			profileSource: 'guess',
			profileId: null,
			name: entryLabel(chosen)
		};
	}
	const guess = vendorId !== null ? guessProtocol(vendorId) : undefined;
	if (!guess) return null;
	return {
		protocol: guess,
		profile: guessedProfile(guess, fallbackName),
		profileSource: 'guess',
		profileId: null,
		name: fallbackName
	};
}

function connection(
	transportKind: BridgeConnectionType,
	transport: Transport,
	r: Resolved,
	reopen?: DeviceConnection['reopen']
): DeviceConnection {
	const device = openDevice(transport, r.protocol, {
		profile: { bandCount: r.profile.bandCount },
		log: (message) => logger.debug(message)
	});
	return {
		device,
		connectionType: transportKind,
		name: r.name,
		profile: r.profile,
		profileSource: r.profileSource,
		profileId: r.profileId,
		identity: device.identity,
		...(reopen ? { reopen } : {})
	};
}

/**
 * Walks one chosen device from its identity to an open connection. `open` turns the resolved
 * protocol into a transport (HID is open already; serial and BLE open once the protocol is known,
 * since it sets the baud rate or GATT layout). `pickFrom` is what to offer when nothing matched.
 */
async function identify(opts: {
	kind: BridgeConnectionType;
	identity: DeviceIdentity;
	fallbackName: string;
	vendorId: number | null;
	open: (protocol: Protocol) => Promise<Transport>;
	close: () => Promise<void>;
	pickFrom: IndexEntry[];
	reopen?: (r: Resolved) => DeviceConnection['reopen'];
}): Promise<ConnectResult> {
	let found = await eqcapsClient().matchDevice(opts.identity);
	// Serial and BLE ports open on the protocol they are driven with, so only an open HID device
	// is asked. A firmware no profile covers keeps the match without it.
	const firmware = opts.kind === 'hid' ? await readFirmware(found.matches, opts.open) : null;
	if (firmware) {
		const again = await eqcapsClient().matchDevice({ ...opts.identity, firmware });
		logger.info(`firmware ${firmware}: ${again.matches.map((x) => x.id).join(', ') || 'no match'}`);
		if (again.matches.length > 0) found = again;
	}
	const { best, matches, ambiguous } = found;

	const finishWith = async (chosen: IndexEntry | null): Promise<ConnectResult> => {
		const r = await resolve(matches, chosen, opts.fallbackName, opts.vendorId);
		if (!r) {
			await opts.close();
			return { kind: 'unsupported', identity: opts.identity };
		}
		const transport = await opts.open(r.protocol);
		return {
			kind: 'connected',
			connection: connection(opts.kind, transport, r, opts.reopen?.(r))
		};
	};

	const offer = ambiguous ? topTies(matches).map((m) => m.entry) : best ? [] : opts.pickFrom;
	if (best) return finishWith(best.entry);
	if (offer.length > 0 && (ambiguous || opts.vendorId === null || !guessProtocol(opts.vendorId))) {
		return {
			kind: 'choose',
			candidates: candidateLabels(offer).map((label, i) => ({ id: offer[i].id, label })),
			finish: (id) => finishWith(offer.find((e) => e.id === id) ?? null),
			cancel: opts.close
		};
	}
	return finishWith(null);
}

let indexLoad: Promise<IndexEntry[]> | null = null;

/**
 * Start loading the index ahead of a click. The browser's choosers need the click's user
 * activation, which a slow fetch in between can use up, so the connect buttons call this on hover
 * and focus. Only the request in flight is shared; the client caches the answer itself.
 */
export function warmUp(): Promise<IndexEntry[]> {
	indexLoad ??= eqcapsClient()
		.loadIndex()
		.then((index) => index?.profiles ?? [])
		.finally(() => {
			indexLoad = null;
		});
	return indexLoad;
}

/** How long a click waits for the index before opening the chooser without it, ms. */
const INDEX_WAIT_MS = 1500;

/**
 * The index entries, or none if they take longer than `INDEX_WAIT_MS`: the HID chooser then offers
 * the vendors the bridge can guess, and the device is still matched once the index arrives.
 */
async function indexEntries(): Promise<IndexEntry[]> {
	const timeout = new Promise<null>((r) => setTimeout(() => r(null), INDEX_WAIT_MS));
	return (await Promise.race([warmUp(), timeout])) ?? [];
}

/** USB HID: the chooser offers the database's devices plus the vendors the bridge can guess. */
export async function connectHid(): Promise<ConnectResult> {
	const entries = await indexEntries();
	const transport = await requestHidDevice({ entries });
	if (!transport || transport.kind !== 'hid') return { kind: 'cancelled' };
	const identity = identityOf(transport);
	const usb = identity.usb;
	return identify({
		kind: 'hid',
		identity,
		fallbackName: usb?.productName?.trim() || 'USB device',
		vendorId: usb ? parseInt(usb.vendorId, 16) : null,
		open: async () => transport,
		close: () => transport.close().catch(() => {}),
		pickFrom: [],
		reopen: (r) => {
			if (!usb?.productId || usb.productName === undefined) return undefined;
			return reopenHid(usbIdentities(usb, r.profile), r);
		}
	});
}

/**
 * How long after a save the old WebHID handle, if the browser never dropped it, is taken as the
 * device back, ms. The FOLA on macOS keeps its HID interface through the restart, and its old
 * handle opens again; this gives a device that does drop it time to go first.
 */
const REUSE_HANDLE_MS = 1500;

/**
 * Finds a granted WebHID device again, as any of its `identities`, and gives the connection it
 * comes back as the same `reopen`, so a device that restarts on every save can be reopened after
 * each one. One that came back under a new identity is only found once the chooser has offered it.
 */
function reopenHid(
	identity: readonly HidIdentity[],
	r: Resolved
): NonNullable<DeviceConnection['reopen']> {
	const reopen = async (wait?: ReopenWait) => {
		const watch = wait ? watchHid() : null;
		const again = wait
			? await waitForGrantedHidDevice(identity, {
					timeoutMs: wait.timeoutMs,
					ignoreCurrent: true,
					reuseAfterMs: REUSE_HANDLE_MS,
					...(wait.onEvent ? { onEvent: wait.onEvent } : {})
				})
			: await grantedHidDevice(identity);
		if (!again && watch) await watch.missed(identity);
		return again ? connection('hid', again, r, reopen) : null;
	};
	return reopen;
}

/** How long after a restart every HID device the browser reports is logged, ms. */
const WATCH_HID_MS = 30_000;

const hidLabel = (d: { vendorId: number; productId: number; productName: string }) =>
	`${usbHex(d.vendorId)}:${usbHex(d.productId)} "${d.productName}"`;

/**
 * For the log, when a device restarting isn't found: every HID connect and disconnect the browser
 * reports for a while (only granted devices are reported), and what is granted when the wait gives
 * up. Tells a device that is slow to come back from one back under an identity not looked for, or
 * not granted.
 */
function watchHid() {
	const hid =
		typeof navigator !== 'undefined' ? (navigator as Navigator & { hid?: HidLike }).hid : undefined;
	const start = performance.now();
	const on = (what: string) => (e: { device: HidDeviceLike }) =>
		logger.info(
			`HID ${what} at ${Math.round(performance.now() - start)} ms: ${hidLabel(e.device)}`
		);
	const connected = on('connect');
	const disconnected = on('disconnect');
	hid?.addEventListener?.('connect', connected);
	hid?.addEventListener?.('disconnect', disconnected);
	setTimeout(() => {
		hid?.removeEventListener?.('connect', connected);
		hid?.removeEventListener?.('disconnect', disconnected);
	}, WATCH_HID_MS);
	return {
		async missed(identity: readonly HidIdentity[]) {
			const granted = (await hid?.getDevices().catch(() => [])) ?? [];
			logger.warn(
				`looked for ${identity.map(hidLabel).join(', ')}; granted now: ` +
					(granted.map(hidLabel).join(', ') || 'none') +
					`; HID connects in the next ${WATCH_HID_MS / 1000} s are logged`
			);
		}
	};
}

/**
 * USB or Bluetooth serial. A Bluetooth port shows only its service class, which several devices
 * share, so an unmatched port asks which device it is.
 */
export async function connectSerial(): Promise<ConnectResult> {
	const entries = await indexEntries();
	const choice = await requestSerialPort({ entries });
	if (!choice) return { kind: 'cancelled' };
	return identify({
		kind: 'serial',
		identity: choice.identity,
		fallbackName: 'Serial device',
		vendorId: null,
		open: (protocol) => choice.open(protocol),
		close: async () => {},
		pickFrom: drivable(entries, 'serial')
	});
}

/** Bluetooth LE: matched by advertised name. */
export async function connectBle(): Promise<ConnectResult> {
	const entries = await indexEntries();
	const choice = await requestBleDevice({ entries });
	if (!choice) return { kind: 'cancelled' };
	return identify({
		kind: 'ble',
		identity: choice.identity,
		fallbackName: choice.identity.bluetooth?.name ?? 'Bluetooth device',
		vendorId: null,
		open: (protocol) => choice.open(protocol),
		close: async () => {},
		pickFrom: drivable(entries, 'ble')
	});
}

// ── Demo ────────────────────────────────────────────────────────────────────

/**
 * The demo device: a simulated FiiO-protocol DAC, driven by the real bridge through
 * `openDevice`. Reopening finds the same simulated device, with what was written to it.
 */
export async function connectDemo(): Promise<ConnectResult> {
	const protocol = protocolOf(DEMO_PROFILE);
	if (!protocol) throw new Error('the demo profile has no protocol this bridge drives');
	const r: Resolved = {
		protocol,
		profile: DEMO_PROFILE,
		profileSource: 'demo',
		profileId: DEMO_PROFILE.id,
		name: `${DEMO_PROFILE.device.brand} ${DEMO_PROFILE.device.model}`
	};
	const open = (): DeviceConnection =>
		connection('hid', new DemoHidTransport(demoDac()), r, async () => open());
	return { kind: 'connected', connection: open() };
}

// ── Android ─────────────────────────────────────────────────────────────────

const nativeIdentity = (d: NativeUsbDevice): DeviceIdentity => ({
	usb: { vendorId: usbHex(d.vendorId), productId: usbHex(d.productId), productName: d.productName }
});

/** Whether an attached device is one the database matches or the bridge can guess. */
export async function drivableNative(d: NativeUsbDevice): Promise<boolean> {
	if (d.hidInterfaces.length === 0) return false;
	if (guessProtocol(d.vendorId)) return true;
	const { matches } = await eqcapsClient().matchDevice(nativeIdentity(d));
	return matches.length > 0;
}

async function openNative(
	device: NativeUsbDevice,
	plugin?: DeviceIoPlugin
): Promise<ConnectResult> {
	// Asked here rather than inside `openNativeHid`, so a refusal reads as a cancelled chooser.
	if (!device.hasPermission) {
		const { granted } = await (plugin ?? DeviceIo).requestPermission({
			deviceName: device.deviceName
		});
		if (!granted) return { kind: 'cancelled' };
	}
	const transport = await openNativeHid({ ...device, hasPermission: true }, plugin);
	const identity = identityOf(transport);
	const result = await identify({
		kind: 'hid',
		identity,
		fallbackName: device.productName.trim() || 'USB device',
		vendorId: device.vendorId,
		open: async () => transport,
		close: () => transport.close().catch(() => {}),
		pickFrom: [],
		reopen: (r) => reopenNative(device, r, plugin)(device.deviceName)
	});
	return withDeviceName(result, device.deviceName);
}

/**
 * Finds an attached device again by vendor id, product id and product name, as any of the
 * identities its profile lists. Android grants USB permission per attach, so a device back from a
 * restart asks for it again. `reopenNative(…)(path)` is the `reopen` of the connection at `path`;
 * the connection it reopens gets its own.
 */
function reopenNative(match: NativeUsbDevice, r: Resolved, plugin?: DeviceIoPlugin) {
	const identities = usbIdentities(nativeIdentity(match).usb, r.profile);
	const same = (d: NativeUsbDevice) => identities.some((i) => sameUsb(i, d));
	const open = async (d: NativeUsbDevice): Promise<DeviceConnection | null> => {
		if (!d.hasPermission) {
			const { granted } = await (plugin ?? DeviceIo).requestPermission({
				deviceName: d.deviceName
			});
			if (!granted) return null;
		}
		const transport = await openNativeHid({ ...d, hasPermission: true }, plugin);
		const conn = connection('hid', transport, r, reopenFrom(d.deviceName));
		return { ...conn, usbDeviceName: d.deviceName };
	};
	const reopenFrom =
		(current: string) =>
		async (wait?: ReopenWait): Promise<DeviceConnection | null> => {
			if (!wait) {
				const now = (await listNativeHidDevices(plugin)).find(same);
				return now ? open(now) : null;
			}
			// The device restarting comes back at a new path; the old one may still be listed.
			const back = await nativeAttach(
				(d) => same(d) && d.deviceName !== current,
				wait.timeoutMs,
				plugin
			);
			if (back) wait.onEvent?.('connect');
			return back ? open(back) : null;
		};
	return reopenFrom;
}

/** The first attached device `match` takes, listed now or attached within `timeoutMs`; else null. */
async function nativeAttach(
	match: (d: NativeUsbDevice) => boolean,
	timeoutMs: number,
	plugin?: DeviceIoPlugin
): Promise<NativeUsbDevice | null> {
	let done = (_d: NativeUsbDevice | null) => {};
	const found = new Promise<NativeUsbDevice | null>((resolve) => (done = resolve));
	// Listening before listing, so an attach in between isn't missed.
	const handle = await (plugin ?? DeviceIo).addListener('deviceAttached', ({ device }) => {
		if (match(device)) done(device);
	});
	const timer = setTimeout(() => done(null), timeoutMs);
	const listed = (await listNativeHidDevices(plugin)).find(match);
	if (listed) done(listed);
	const device = await found;
	clearTimeout(timer);
	await handle.remove();
	return device;
}

/** Tags the connection a result comes to, now or after a pick, with the plugin's device path. */
function withDeviceName(result: ConnectResult, usbDeviceName: string): ConnectResult {
	if (result.kind === 'connected') {
		return { ...result, connection: { ...result.connection, usbDeviceName } };
	}
	if (result.kind === 'choose') {
		const { finish } = result;
		return { ...result, finish: async (id) => withDeviceName(await finish(id), usbDeviceName) };
	}
	return result;
}

/**
 * Android USB HID, over the DeviceIo plugin: there is no browser chooser, so this looks at what is
 * attached. One drivable device opens straight away (after the system's USB permission prompt);
 * several ask which one. `plugin` is for specs.
 */
export async function connectNativeHid(plugin?: DeviceIoPlugin): Promise<ConnectResult> {
	const attached = await listNativeHidDevices(plugin);
	const known = (
		await Promise.all(attached.map(async (d) => ((await drivableNative(d)) ? d : null)))
	).filter((d) => d !== null);
	if (known.length === 0) return { kind: 'no-device' };
	if (known.length === 1) return openNative(known[0], plugin);
	return {
		kind: 'choose',
		candidates: known.map((d) => ({
			id: d.deviceName,
			label: [d.manufacturerName, d.productName].filter(Boolean).join(' ') || d.deviceName
		})),
		finish: async (id) => {
			const device = known.find((d) => d.deviceName === id);
			return device ? openNative(device, plugin) : { kind: 'cancelled' };
		},
		cancel: async () => {}
	};
}
