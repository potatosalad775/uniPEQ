import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { thirdPartyLicenses } from './scripts/third-party-licenses.ts';

const pkg = JSON.parse(
	readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
);

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		thirdPartyLicenses(),
		// Keep these options in sync with the `i18n:compile` script in package.json, which compiles
		// the same output for `npm run check`: svelte-check does not run Vite, so without it
		// $lib/paraglide/* has no type declarations on a fresh clone.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['localStorage', 'preferredLanguage', 'baseLocale']
		})
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
