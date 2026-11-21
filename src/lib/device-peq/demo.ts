/**
 * The demo device: an app-local eqcaps profile and a simulated USB HID device
 * that speaks `fiio-usb-hid`, so the zero-hardware path runs the real bridge, `fit` and push path.
 *
 * It holds an EQ per output channel, so setting the channels apart can be tried without the one
 * device that has it. FiiO's protocol carries one channel, so each channel is reached through a
 * transport of its own into the same simulated DAC (`stereo`): every byte still goes through the
 * real handler, and only the routing a per-channel handler does itself is added here.
 *
 * The simulation keeps the device's state for the page's lifetime, so a write survives a
 * disconnect and reads back on the next connection, as on hardware. Only reached through a dynamic
 * `import()`, like the rest of the connect path.
 */
import type { Filter, Profile } from '@potatosalad775/eqcaps-core';
import {
	BridgeError,
	HANDLERS,
	type HidCollectionInfo,
	type HidTransport
} from '@potatosalad775/eqcaps-device-bridge';
import type { Channel } from '#lib/eq/model.js';
import type { PeqDevice } from './types';

const REPORT_ID = 7;
const BYPASS = 0;

export const DEMO_PROFILE: Profile = {
	schemaVersion: '1.4',
	id: 'unipeq-demo-dac',
	kind: 'hardware',
	device: { brand: 'uniPEQ', model: 'Demo DAC' },
	bandCount: 10,
	channels: 'independent',
	band: {
		types: ['PK', 'LSC', 'HSC'],
		freq: { min: 20, max: 20000, step: 1 },
		q: { min: 0.1, max: 10, step: 0.01 },
		gain: { min: -12, max: 12, step: 0.1 }
	},
	preamp: { mode: 'manual', gain: { min: -12, max: 0, step: 0.1 } },
	protocol: {
		handler: 'fiio-usb-hid',
		options: { reportId: REPORT_ID },
		presets: [
			{ id: 1, name: 'USER1' },
			{ id: 2, name: 'USER2' },
			{ id: 3, name: 'USER3' },
			{ id: BYPASS, name: 'Bypass', bypass: true }
		]
	},
	meta: {
		// The device is this file's simulation, so this file is its vendor documentation.
		status: 'community-verified',
		sources: [
			{
				kind: 'vendor-docs',
				ref: 'https://github.com/potatosalad775/uniPEQ/blob/main/src/lib/device-peq/demo.ts',
				date: '2026-10-07'
			}
		],
		notes:
			'Simulated in uniPEQ: a FiiO-protocol DAC with three user presets and a bypass, and an EQ per output channel.'
	}
};

// fiio-usb-hid frames (see the bridge's handler): set `AA 0A 00 00 <cmd> <len> <data…> 00 EE`,
// get `BB 0B 00 00 <cmd> <len> <data…> 00 EE`, answered in kind.
const SET = 0xaa;
const GET = 0xbb;
const BAND = 0x15;
const PRESET = 0x16;
const PREAMP = 0x17;
const COUNT = 0x18;
const SAVE = 0x19;

/** One EQ memory, as the device holds it: raw band bytes, so it echoes exactly what it got. */
interface Memory {
	/** Preamp, s16 BE ×10. */
	preamp: [number, number];
	/** Per band: gain s16 BE ×10, freq u16 BE, q u16 BE ×100, type. All zero: unused. */
	bands: number[][];
}

const EMPTY_BAND = [0, 0, 0, 0, 0, 0, 0];
const clone = (m: Memory): Memory => ({ preamp: [...m.preamp], bands: m.bands.map((b) => [...b]) });

const pk = (freq: number, q: number, gain: number): Filter => ({ type: 'PK', freq, q, gain });

const SEED: Record<number, { preamp: number; filters: Filter[] }> = {
	1: {
		preamp: -4.5,
		filters: [
			{ type: 'LSC', freq: 105, q: 0.7, gain: 4.5 },
			pk(200, 1, -1.5),
			pk(600, 1.4, 0),
			pk(1500, 2, -1),
			pk(2800, 2.5, 2.5),
			pk(4000, 3, -2),
			pk(6500, 4, -3),
			pk(8000, 2, 0),
			pk(11000, 1, 1.5),
			{ type: 'HSC', freq: 10000, q: 0.7, gain: -2 }
		]
	},
	2: {
		preamp: 0,
		filters: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f) => pk(f, 1.41, 0))
	},
	3: { preamp: -3, filters: [pk(60, 0.8, 3), pk(3000, 2, -2.5), pk(7000, 5, -4)] }
};

/** One output channel: its memories, and what it plays (the current one, as edited since). */
interface ChannelState {
	memories: Map<number, Memory>;
	live: Memory;
}

/**
 * The simulated device: each output channel's memories and what it is playing. The preset played
 * is the device's, both channels' at once.
 */
export class DemoDac {
	channels: Record<Channel, ChannelState> = {
		left: { memories: new Map(), live: { preamp: [0, 0], bands: [] } },
		right: { memories: new Map(), live: { preamp: [0, 0], bands: [] } }
	};
	/** The preset being played; `BYPASS` is the EQ off. */
	current = 1;

	constructor() {
		// Both channels alike: a device straight from the box plays one EQ on both.
		for (const channel of ['left', 'right'] as const) {
			for (const [slot, seed] of Object.entries(SEED)) {
				// Seeded through the device's own write path, from the bridge's encoder.
				const frames = HANDLERS['fiio-usb-hid'].codec.encode(
					{ filters: seed.filters, preamp: seed.preamp, slot: Number(slot) },
					{ reportId: REPORT_ID }
				);
				this.channels[channel].live = { preamp: [0, 0], bands: [] };
				for (const frame of frames) this.receive(frame.data, channel);
			}
			const state = this.channels[channel];
			state.live = clone(state.memories.get(this.current)!);
		}
	}

	/**
	 * A set command changes the device; a get command returns the answer's data bytes. Bands and
	 * preamp are `channel`'s; a preset switch is both channels'.
	 */
	receive(d: Uint8Array, channel: Channel = 'left'): number[] | null {
		const cmd = d[4];
		const data = Array.from(d.subarray(6, 6 + d[5]));
		if (d[0] === SET) {
			this.set(cmd, data, channel);
			return null;
		}
		if (d[0] !== GET) return null;
		const live = this.channels[channel].live;
		switch (cmd) {
			case PRESET:
				return [this.current];
			case COUNT:
				return [live.bands.length];
			case PREAMP:
				return [...live.preamp];
			case BAND:
				return [data[0], ...(live.bands[data[0]] ?? EMPTY_BAND)];
			default:
				return null;
		}
	}

	private set(cmd: number, data: number[], channel: Channel): void {
		const state = this.channels[channel];
		const live = state.live;
		switch (cmd) {
			case PRESET: {
				this.current = data[0];
				for (const each of Object.values(this.channels)) {
					const memory = each.memories.get(data[0]);
					if (memory) each.live = clone(memory);
				}
				break;
			}
			case COUNT:
				live.bands = Array.from({ length: data[0] }, (_, i) => live.bands[i] ?? [...EMPTY_BAND]);
				break;
			case PREAMP:
				live.preamp = [data[0], data[1]];
				break;
			case BAND:
				live.bands[data[0]] = data.slice(1, 8);
				break;
			case SAVE: {
				state.memories.set(data[0], clone(live));
				// Saving into another memory doesn't change what plays.
				const playing = state.memories.get(this.current);
				if (data[0] !== this.current && playing) state.live = clone(playing);
				break;
			}
		}
	}
}

const COLLECTIONS: HidCollectionInfo[] = [
	{
		usagePage: 0xff00,
		usage: 1,
		inputReports: [{ reportId: REPORT_ID, size: 63 }],
		outputReports: [{ reportId: REPORT_ID, size: 63 }],
		featureReports: [],
		children: []
	}
];

/**
 * A USB HID connection to a `DemoDac`, answering like the device after a short delay. Its bands
 * and preamp are `channel`'s.
 */
export class DemoHidTransport implements HidTransport {
	readonly kind = 'hid';
	/** pid.codes' test vendor and product. */
	readonly vendorId = 0x1209;
	readonly productId = 0x0001;
	readonly productName = 'uniPEQ Demo DAC';
	readonly collections = COLLECTIONS;

	#listeners = new Set<(reportId: number, data: Uint8Array) => void>();
	#closed = false;

	constructor(
		readonly dac: DemoDac,
		private readonly latencyMs = 5,
		private readonly channel: Channel = 'left'
	) {}

	async sendReport(reportId: number, data: Uint8Array): Promise<void> {
		if (this.#closed) throw new BridgeError('transport', 'demo device closed');
		if (reportId !== REPORT_ID) return;
		const answer = this.dac.receive(data, this.channel);
		if (!answer) return;
		const frame = Uint8Array.from([GET, 0x0b, 0, 0, data[4], answer.length, ...answer, 0, 0xee]);
		setTimeout(() => {
			for (const listener of this.#listeners) listener(REPORT_ID, frame);
		}, this.latencyMs);
	}

	async sendFeatureReport(): Promise<void> {
		throw new BridgeError('unsupported', 'the demo device has no feature reports');
	}

	async receiveFeatureReport(): Promise<Uint8Array> {
		throw new BridgeError('unsupported', 'the demo device has no feature reports');
	}

	onInputReport(listener: (reportId: number, data: Uint8Array) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async close(): Promise<void> {
		this.#closed = true;
		this.#listeners.clear();
	}
}

/**
 * The demo device as one that drives its channels apart (`perChannel`), from the same DAC opened
 * once per channel. A write's `right` goes to the right channel, and left out, its list goes to
 * both; a read returns both. The preset, the EQ switch and the rest are the device's, through the
 * left.
 */
export function stereo(left: PeqDevice, right: PeqDevice): PeqDevice {
	return {
		capabilities: { ...left.capabilities, perChannel: true },
		async pull(request) {
			const held = await left.pull(request);
			const other = await right.pull(request);
			const preamp = other.preamp !== undefined ? { preamp: other.preamp } : {};
			return { ...held, right: { filters: other.filters, ...preamp } };
		},
		async push({ right: apart, ...request }) {
			const result = await left.push(request);
			const preamp = apart?.preamp ?? request.preamp;
			await right.push({
				...request,
				filters: apart?.filters ?? request.filters,
				...(preamp !== undefined ? { preamp } : {})
			});
			return result;
		},
		currentSlot: () => left.currentSlot(),
		eqEnabled: () => left.eqEnabled(),
		setEnabled: (enabled, slot) => left.setEnabled(enabled, slot),
		firmware: () => left.firmware(),
		bandCount: () => left.bandCount(),
		readControls: () => left.readControls(),
		writeControl: (id, value) => left.writeControl(id, value),
		eq: (id) => stereo(left.eq(id), right.eq(id)),
		async close() {
			await left.close();
			await right.close();
		}
	};
}

let dac: DemoDac | null = null;

/** The page's one demo device, made on first use. */
export function demoDac(): DemoDac {
	return (dac ??= new DemoDac());
}

/** Start over with a freshly seeded device, as a page reload would (specs). */
export function resetDemoDac(): void {
	dac = null;
}
