// A Button's size comes from its `size` prop, so buttons in the same role match across the app; a
// `class` sets layout (flex-1, shrink-0, gap, margins) and colour, never padding, height or text
// size. A size the props don't have goes into Button.svelte.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');

/** Padding, height and text-size utilities, after any variant prefix (`touch:`, `hover:`). */
const SIZING = /^-?(p[xytrblse]?|h|min-h|max-h|size)-|^text-(xs|sm|base|lg|\d*xl|\[)/;

function sizingClasses(file: string): string[] {
	const found: string[] = [];
	const source = readFileSync(join(ROOT, file), 'utf8');
	for (const tag of source.matchAll(/<Button\b[\s\S]*?>/g)) {
		// The literal part of `class="…"`; an expression's value isn't known here.
		const literal = tag[0].match(/\sclass="([^"]*)"/)?.[1]?.replace(/\{[^}]*\}/g, ' ') ?? '';
		for (const name of literal.split(/\s+/).filter(Boolean)) {
			if (SIZING.test(name.split(':').pop()!)) found.push(`${file}: ${name}`);
		}
	}
	return found;
}

describe('Button sizes', () => {
	it('come from the size prop, not a class', () => {
		const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' }).filter(
			(f) => f.endsWith('.svelte') && !f.endsWith('Button.svelte')
		);
		expect(files.length).toBeGreaterThan(0);
		expect(files.flatMap(sizingClasses)).toEqual([]);
	});
});
