import { describe, expect, it } from 'vitest';
import type { DataBundle } from '@potatosalad775/eqcaps-core';
import { protocolOf } from '@potatosalad775/eqcaps-device-bridge';
import { readFileSync } from 'node:fs';
import { WRITABLE_PRESETS, writableSlots } from './writable';

const bundleUrl = new URL('../data/eqcaps-bundle.json', import.meta.url);
const profiles = (JSON.parse(readFileSync(bundleUrl, 'utf-8')) as DataBundle).profiles;
const presetsOf = (id: string) => protocolOf(profiles.find((p) => p.id === id))?.presets ?? [];
const USER = /^(USER ?\d+|Custom( \d+)?|Custom EQ)$/i;

describe('WRITABLE_PRESETS', () => {
	it('names only existing, non-bypass presets of existing profiles', () => {
		for (const [id, writable] of Object.entries(WRITABLE_PRESETS)) {
			const memories = presetsOf(id).filter((s) => !s.bypass);
			expect(memories.length, id).toBeGreaterThan(0);
			for (const slot of writable) {
				expect(
					memories.some((s) => s.id === slot),
					`${id} preset ${slot}`
				).toBe(true);
			}
		}
	});

	it('covers every snapshot profile that mixes user memories with built-in presets', () => {
		for (const profile of profiles) {
			const memories = (protocolOf(profile)?.presets ?? []).filter((s) => !s.bypass);
			const user = memories.filter((s) => USER.test(s.name));
			if (user.length === 0 || user.length === memories.length) continue;
			expect(WRITABLE_PRESETS[profile.id], profile.id).toEqual(user.map((s) => s.id));
		}
	});
});

describe('writableSlots', () => {
	const slots = [
		{ id: 0, name: 'Jazz' },
		{ id: 4, name: 'USER1' },
		{ id: 8, name: 'USER2' },
		{ id: 9, name: 'USER3' },
		{ id: 10, name: 'BYPASS', bypass: true }
	];

	it('keeps the listed user memories of a known profile', () => {
		expect(writableSlots('fiio-ka17', slots).map((s) => s.name)).toEqual([
			'USER1',
			'USER2',
			'USER3'
		]);
	});

	it('leaves unlisted and guessed devices unrestricted, bypass aside', () => {
		expect(writableSlots('walkplay-cs431xx', slots)).toHaveLength(4);
		expect(writableSlots(null, slots)).toHaveLength(4);
	});
});
