import adapter from '@sveltejs/adapter-static';

// One version name per build. SvelteKit defaults it to `Date.now()` at each config load, and a
// build loads this file more than once (again in the worker that writes the fallback index.html).
// When two loads straddle a millisecond, index.html and the client chunks disagree on the
// `__sveltekit_*` global and the page boots blank. Workers inherit process.env, so the first
// load's value wins everywhere. (Same fix as modernGraphTool's svelte.config.js.)
process.env.UNIPEQ_BUILD_VERSION ??= Date.now().toString();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
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
		paths: { base: process.env.BASE_PATH ?? '' },
		version: { name: process.env.UNIPEQ_BUILD_VERSION },
		// src/service-worker.ts is registered by $lib/platform/pwa, on the web only: in the
		// Capacitor app the files are already local.
		serviceWorker: { register: false }
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
