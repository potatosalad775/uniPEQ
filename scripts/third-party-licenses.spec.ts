import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bundledPackages, packageRoot } from './third-party-licenses.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

describe('packageRoot', () => {
	it('names the package a module sits in', () => {
		expect(packageRoot('/app/node_modules/svelte/src/index.js')).toBe('/app/node_modules/svelte');
		expect(packageRoot('/app/node_modules/@floating-ui/dom/dist/x.mjs')).toBe(
			'/app/node_modules/@floating-ui/dom'
		);
	});

	it('takes the innermost node_modules, and drops queries and the virtual prefix', () => {
		expect(packageRoot('/app/node_modules/a/node_modules/b/index.js')).toBe(
			'/app/node_modules/a/node_modules/b'
		);
		expect(packageRoot('\0/app/node_modules/c/x.css?inline')).toBe('/app/node_modules/c');
		expect(packageRoot('C:\\app\\node_modules\\d\\x.js')).toBe('C:/app/node_modules/d');
	});

	it("is null for the app's own modules", () => {
		expect(packageRoot('/app/src/lib/eq/biquad.ts')).toBeNull();
		expect(packageRoot('\0virtual:third-party-licenses')).toBeNull();
	});
});

describe('bundledPackages', () => {
	it('lists each package once, by name, with its license file', () => {
		const notices = bundledPackages([
			`${ROOT}/node_modules/svelte/src/internal/client/index.js`,
			`${ROOT}/node_modules/svelte/src/index-client.js`,
			`${ROOT}/node_modules/bits-ui/dist/index.js`,
			`${ROOT}/src/routes/+layout.svelte`
		]);
		expect(notices.map((n) => n.name)).toEqual(['bits-ui', 'svelte']);
		expect(notices[1].license).toBe('MIT');
		expect(notices[1].text).toContain('Permission is hereby granted');
	});
});
