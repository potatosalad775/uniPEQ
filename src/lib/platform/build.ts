/**
 * Which build this is, from the Vite mode: `vite dev` (development), `vite build --mode debug`
 * (the debug APK, `npm run android`), specs (test), or a release (`vite build`, production).
 * Vite inlines `import.meta.env.MODE`, so what only debug builds show drops out of a release.
 */
const mode = import.meta.env.MODE;

/** Not a release: the build badge is shown. */
export const isDebugBuild = mode !== 'production';

/** The badge's text, or null in a release. */
export const buildLabel: string | null = !isDebugBuild
	? null
	: mode === 'development'
		? 'DEV'
		: mode.toUpperCase();

/**
 * Where this build is installed from, for updates: `github` is the sideloaded APK attached to
 * GitHub releases (`npm run android:release -- --sideload` sets VITE_DISTRIBUTION), which checks
 * for newer releases itself. Anything else (Play, the web, dev) leaves updates to its store or
 * service worker.
 */
export const distribution: 'github' | 'default' =
	import.meta.env.VITE_DISTRIBUTION === 'github' ? 'github' : 'default';
