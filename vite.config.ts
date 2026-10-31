import adapter from '@sveltejs/adapter-static';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { writeAndroidStrings } from './scripts/android-strings.js';
import { localEqcaps } from './scripts/local-eqcaps.ts';
import { thirdPartyLicenses } from './scripts/third-party-licenses.ts';

const pkg = JSON.parse(
	readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
);

// One version name per build. SvelteKit defaults it to `Date.now()` at each config load, and a
// build loads this file more than once (again in the worker that writes the fallback index.html).
// When two loads straddle a millisecond, index.html and the client chunks disagree on the
// `__sveltekit_*` global and the page boots blank. Workers inherit process.env, so the first
// load's value wins everywhere. (Same fix as modernGraphTool.)
process.env.UNIPEQ_BUILD_VERSION ??= Date.now().toString();

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			// SPA: no prerendered pages, every path falls back to index.html. Capacitor's `webDir` is
			// this output directory, and its local server also falls back to index.html.
			adapter: adapter({
				pages: 'dist',
				assets: 'dist',
				fallback: 'index.html',
				precompress: false
			}),
			// The GitHub Pages build sets BASE_PATH (`/uniPEQ`, from actions/configure-pages); the app and
			// Capacitor serve from the root. Links go through `resolve()` from `$app/paths`, so they follow it.
			paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` },
			version: { name: process.env.UNIPEQ_BUILD_VERSION },
			// src/service-worker/ is registered by #lib/platform/pwa, on the web only: in the
			// Capacitor app the files are already local.
			serviceWorker: { register: false },
			// Options SvelteKit doesn't own go on to vite-plugin-svelte.
			dynamicCompileOptions: ({ filename }) =>
				filename.includes('node_modules') ? undefined : { runes: true }
		}),
		thirdPartyLicenses(),
		// `npm run dev:eqcaps`: eqcaps source and data from a local checkout instead of the published ones.
		localEqcaps(),
		// Keep these options in sync with the `i18n:compile` script in package.json, which compiles
		// the same output for `npm run check`: svelte-check does not run Vite, so without it
		// #lib/paraglide/* has no type declarations on a fresh clone.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['localStorage', 'preferredLanguage', 'baseLocale']
		}),
		// Every Android build (`android:sync*`, `npm run android`, CI) starts with a Vite build, so
		// the native strings are regenerated from messages/*.json before `cap sync` and Gradle.
		{ name: 'android-strings', apply: 'build', buildStart: writeAndroidStrings }
	],
	server: {
		// Capacitor live reload (`cap run android -l --external`) reaches the dev server over the LAN.
		host: true
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				// Pre-bundling bits-ui gives it its own copy of the Svelte client runtime, and a
				// component rendered by one instance can't read the other's context. Tests only.
				optimizeDeps: { exclude: ['bits-ui'] },
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						// Browser mode defaults to a 414x896 iframe, which is the phone layout. Default to
						// desktop; phone-layout specs opt in with `page.viewport()`.
						viewport: { width: 1280, height: 800 },
						instances: [{ browser: 'chromium', headless: true }]
					},
					setupFiles: ['./src/test-setup.client.ts'],
					include: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
