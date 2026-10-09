/**
 * Which build this is, from the Vite mode: `vite dev` (development), `vite build --mode debug`
 * (the debug APK, `npm run android`), specs (test), or a release (`vite build`, production).
 * Vite inlines `import.meta.env.MODE`, so what only debug builds show drops out of a release.
 */
const mode = import.meta.env.MODE;

/** Not a release: the demo device and the build badge are offered. */
export const isDebugBuild = mode !== 'production';

/** The badge's text, or null in a release. */
export const buildLabel: string | null = !isDebugBuild
	? null
	: mode === 'development'
		? 'DEV'
		: mode.toUpperCase();
