/**
 * The preset file: schemaVersion 2 (eqcaps type codes, rebuild decision 5), what a stored or
 * imported preset is checked against, and the migration from the prototype's schemaVersion 1.
 *
 * v1 named the types differently (`LSQ`, `HPF`, `NOTCH`, …). Each maps onto its eqcaps code,
 * except `BSF` and `CQ`, which have no v2 equivalent: they become disabled peaks at their own
 * frequency, Q and gain, so the band stays visible and the caller can warn about it.
 */
import { isKnownType, type FilterType as CapsFilterType } from '@potatosalad775/eqcaps-core';
import { parseApo } from './eq-apo';
import type { EqFilter, FilterType, PeqPreset } from './model';

const V1_TYPES: Record<string, FilterType | null> = {
	PK: 'PK',
	LSQ: 'LSC',
	HSQ: 'HSC',
	LPF: 'LPQ',
	HPF: 'HPQ',
	BPF: 'BP',
	NOTCH: 'NO',
	APF: 'AP',
	BSF: null,
	CQ: null
};

/** Why a file isn't a preset. */
export type PresetErrorCode = 'not-a-preset' | 'version' | 'invalid' | 'empty';

export class PresetError extends Error {
	override name = 'PresetError';
	constructor(
		readonly code: PresetErrorCode,
		message: string
	) {
		super(message);
	}
}

export interface ParsedPreset {
	preset: PeqPreset;
	/** v1 bands whose type has no v2 equivalent, now disabled. */
	disabled: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositive = (v: unknown): v is number => typeof v === 'number' && v > 0 && isFinite(v);

function invalid(message: string): never {
	throw new PresetError('invalid', message);
}

function parseFilter(raw: unknown, version: 1 | 2, index: number): EqFilter & { lost?: true } {
	if (!isObject(raw)) invalid(`filter ${index + 1} is not an object`);
	const { type, freq, q, gain, enabled } = raw;
	if (!isPositive(freq) || !isPositive(q) || typeof gain !== 'number' || !isFinite(gain)) {
		invalid(`filter ${index + 1} needs a positive freq and q and a numeric gain`);
	}
	if (enabled !== undefined && typeof enabled !== 'boolean') {
		invalid(`filter ${index + 1}: enabled must be true or false`);
	}
	const on = enabled ?? true;
	if (typeof type !== 'string') invalid(`filter ${index + 1} has no type`);
	if (version === 2) {
		const known = type as CapsFilterType;
		if (!isKnownType(known)) invalid(`filter ${index + 1} has an unknown type "${type}"`);
		return { type: known, freq, q, gain, enabled: on };
	}
	const mapped = V1_TYPES[type];
	if (mapped === undefined) invalid(`filter ${index + 1} has an unknown type "${type}"`);
	if (mapped === null) return { type: 'PK', freq, q, gain, enabled: false, lost: true };
	return { type: mapped, freq, q, gain, enabled: on };
}

/**
 * A stored or imported preset as schemaVersion 2, migrating a v1 one. Throws a `PresetError`
 * naming the first problem.
 */
export function parsePreset(raw: unknown): ParsedPreset {
	if (!isObject(raw) || !('schemaVersion' in raw)) {
		throw new PresetError('not-a-preset', 'not a uniPEQ preset');
	}
	const version = raw.schemaVersion;
	if (version !== 1 && version !== 2) {
		throw new PresetError('version', `unsupported schemaVersion ${String(version)}`);
	}
	if (typeof raw.id !== 'string' || !raw.id) invalid('the preset has no id');
	if (typeof raw.name !== 'string') invalid('the preset has no name');
	if (!Array.isArray(raw.filters)) invalid('filters must be a list');
	const pregain = raw.pregain ?? 'auto';
	if (pregain !== 'auto' && (typeof pregain !== 'number' || !isFinite(pregain))) {
		invalid('pregain must be a number or "auto"');
	}
	const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [];
	const parsed = raw.filters.map((f, i) => parseFilter(f, version, i));
	const now = new Date().toISOString();
	const preset: PeqPreset = {
		schemaVersion: 2,
		id: raw.id,
		name: raw.name,
		...(typeof raw.description === 'string' ? { description: raw.description } : {}),
		tags,
		createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
		...(isObject(raw.source) && raw.source.app === 'uniPEQ'
			? { source: raw.source as PeqPreset['source'] }
			: {}),
		pregain,
		filters: parsed.map(({ type, freq, q, gain, enabled }) => ({ type, freq, q, gain, enabled }))
	};
	return { preset, disabled: parsed.filter((f) => f.lost).length };
}

/** A new preset holding `filters`, with a fresh id. */
export function createPreset(opts: {
	name: string;
	filters: EqFilter[];
	pregain: number | 'auto';
	deviceId?: string;
	tags?: string[];
}): PeqPreset {
	const now = new Date().toISOString();
	return {
		schemaVersion: 2,
		id: crypto.randomUUID(),
		name: opts.name,
		tags: opts.tags ?? [],
		createdAt: now,
		updatedAt: now,
		source: {
			...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
			app: 'uniPEQ',
			appVersion: __APP_VERSION__
		},
		pregain: opts.pregain,
		filters: opts.filters.map((f) => ({ ...f }))
	};
}

export interface ImportedPreset extends ParsedPreset {
	/** APO lines that couldn't be represented (see `ApoImport.skipped`). */
	skipped: number;
}

/**
 * A preset from a file's text: uniPEQ JSON (v1 or v2), else Equalizer APO / AutoEq text, named
 * after the file. Always a fresh id, so an import never overwrites a stored preset.
 */
export function importPreset(text: string, fileName: string): ImportedPreset {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	if (json !== undefined) {
		const { preset, disabled } = parsePreset(json);
		return { preset: { ...preset, id: crypto.randomUUID() }, disabled, skipped: 0 };
	}
	const apo = parseApo(text);
	if (apo.filters.length === 0) {
		throw new PresetError(
			apo.skipped > 0 ? 'empty' : 'not-a-preset',
			'no filters this app can use'
		);
	}
	const preset = createPreset({
		name: fileName.replace(/\.(txt|json)$/i, '') || 'Imported',
		filters: apo.filters,
		pregain: apo.preamp ?? 'auto'
	});
	return { preset, disabled: 0, skipped: apo.skipped };
}

/** The preset as an exported `.json` file's text. */
export function presetJson(preset: PeqPreset): string {
	return JSON.stringify(preset, null, '\t') + '\n';
}
