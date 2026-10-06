/**
 * HID report descriptor → the bridge's HidCollectionInfo, so the native transport can expose
 * `collections` the way WebHID does (eqcaps browser/webhid.ts `hidCollections`). Also yields the
 * per-report sizes the transport pads output reports to, as WebHID does on Windows and macOS.
 *
 * Covers the short items that shape reports (Usage Page, Usage, Report Size/Count/ID,
 * Push/Pop, Input/Output/Feature, Collection/End Collection); long items are skipped.
 */
import type { HidCollectionInfo, HidReportInfo } from '@potatosalad775/eqcaps-device-bridge';

type Kind = 'input' | 'output' | 'feature';
type BitsByReport = Record<Kind, Map<number, number>>;

export interface ParsedReportDescriptor {
	collections: HidCollectionInfo[];
	/** Payload bytes per report id (report id excluded), summed over the whole descriptor. */
	sizes: Record<Kind, Map<number, number>>;
	/** The descriptor declares report ids, so every report on the wire starts with its id. */
	numbered: boolean;
}

const MAIN: Record<number, Kind> = { 0x80: 'input', 0x90: 'output', 0xb0: 'feature' };

const emptyBits = (): BitsByReport => ({ input: new Map(), output: new Map(), feature: new Map() });

function addBits(map: Map<number, number>, reportId: number, bits: number) {
	map.set(reportId, (map.get(reportId) ?? 0) + bits);
}

function reports(map: Map<number, number>): HidReportInfo[] {
	return [...map].map(([reportId, bits]) =>
		bits > 0 ? { reportId, size: Math.ceil(bits / 8) } : { reportId }
	);
}

function bytesOf(bits: BitsByReport): Record<Kind, Map<number, number>> {
	const out = emptyBits();
	for (const kind of ['input', 'output', 'feature'] as const) {
		for (const [id, b] of bits[kind]) out[kind].set(id, Math.ceil(b / 8));
	}
	return out;
}

export function parseReportDescriptor(bytes: ArrayLike<number>): ParsedReportDescriptor {
	const total = emptyBits();
	const roots: HidCollectionInfo[] = [];
	const open: { info: HidCollectionInfo; bits: BitsByReport }[] = [];
	let global = { usagePage: 0, reportSize: 0, reportCount: 0, reportId: 0 };
	const pushed: (typeof global)[] = [];
	let usages: number[] = [];
	let numbered = false;

	for (let i = 0; i < bytes.length;) {
		const prefix = bytes[i]!;
		if (prefix === 0xfe) {
			i += 3 + (bytes[i + 1] ?? 0);
			continue;
		}
		const size = [0, 1, 2, 4][prefix & 3]!;
		let value = 0;
		for (let k = 0; k < size; k++) value += (bytes[i + 1 + k] ?? 0) * 2 ** (8 * k);
		i += 1 + size;

		const tag = prefix & 0xfc;
		switch (tag) {
			case 0x04:
				global.usagePage = value;
				break;
			case 0x74:
				global.reportSize = value;
				break;
			case 0x84:
				global.reportId = value;
				numbered = true;
				break;
			case 0x94:
				global.reportCount = value;
				break;
			case 0xa4:
				pushed.push({ ...global });
				break;
			case 0xb4:
				global = pushed.pop() ?? global;
				break;
			// A 4-byte Usage carries its own page in the high half.
			case 0x08:
				usages.push(size === 4 ? value : global.usagePage * 0x10000 + value);
				break;
			case 0xa0: {
				const usage = usages[0] ?? global.usagePage * 0x10000;
				const info: HidCollectionInfo = {
					usagePage: Math.floor(usage / 0x10000),
					usage: usage % 0x10000,
					inputReports: [],
					outputReports: [],
					featureReports: [],
					children: []
				};
				(open.at(-1)?.info.children ?? roots).push(info);
				open.push({ info, bits: emptyBits() });
				usages = [];
				break;
			}
			case 0xc0: {
				const done = open.pop();
				if (done) {
					done.info.inputReports = reports(done.bits.input);
					done.info.outputReports = reports(done.bits.output);
					done.info.featureReports = reports(done.bits.feature);
				}
				usages = [];
				break;
			}
			default: {
				const kind = MAIN[tag];
				if (kind) {
					const bits = global.reportSize * global.reportCount;
					addBits(total[kind], global.reportId, bits);
					const inner = open.at(-1);
					if (inner) addBits(inner.bits[kind], global.reportId, bits);
					usages = [];
				}
			}
		}
	}
	return { collections: roots, sizes: bytesOf(total), numbered };
}
