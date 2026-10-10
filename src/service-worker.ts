/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * The web build's offline cache. Registered by `$lib/platform/pwa` on the web only: Capacitor
 * serves the app from the APK, so the native app has nothing to cache.
 *
 * - The app shell (index.html), the JS and CSS chunks and `static/` are cached when the worker
 *   installs, under this build's version. Every navigation gets the cached shell, so the page and
 *   its chunks always come from one build, online or not.
 * - Pretendard's ~90 unicode-range subsets (3 MB) are cached as pages load them, not up front; a
 *   later build keeps the ones it still lists.
 * - A new build's worker waits until the page asks it to take over (`skip-waiting`, from the update
 *   prompt) or every tab has closed. Taking over under an open page would reload it, dropping a
 *   device connection and unwritten edits.
 * - The eqcaps CDN is cross-origin and left alone: the client caches it in localStorage itself.
 */
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `shell-${version}`;
const FONT_CACHE = 'fonts';
const SHELL = `${base}/index.html`;

const isFont = (path: string) => path.endsWith('.woff2');
const precached = new Set([SHELL, ...build.filter((path) => !isFont(path)), ...files]);
const fonts = new Set(build.filter(isFont));

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll([...precached])));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== SHELL_CACHE && key !== FONT_CACHE) await caches.delete(key);
			}
			const fontCache = await caches.open(FONT_CACHE);
			for (const request of await fontCache.keys()) {
				if (!fonts.has(new URL(request.url).pathname)) await fontCache.delete(request);
			}
			// The first install takes the open page at once, so it works offline without a reload.
			// A later one only activates once nothing runs the old build (see the header).
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data?.type === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (precached.has(url.pathname)) {
		event.respondWith(fromCache(SHELL_CACHE, url.pathname, request));
	} else if (fonts.has(url.pathname)) {
		event.respondWith(fromCache(FONT_CACHE, url.pathname, request));
	} else if (request.mode === 'navigate' && url.pathname.startsWith(`${base}/`)) {
		// SPA: every route is the shell (GitHub Pages answers them with 404.html, the same file).
		event.respondWith(fromCache(SHELL_CACHE, SHELL, request));
	}
});

/** Cache first; a miss goes to the network and is kept. */
async function fromCache(name: string, path: string, request: Request): Promise<Response> {
	const cache = await caches.open(name);
	const hit = await cache.match(path);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok && path === new URL(request.url).pathname) {
		await cache.put(path, response.clone());
	}
	return response;
}
