/**
 * The web build's service worker (src/service-worker/): offline use, and an update prompt when a
 * newer build is deployed. Not on native (Capacitor serves the app from the APK) or in `vite dev`.
 */
import { resolve } from '$app/paths';
import { logger } from '#lib/services/logger.js';
import { updateStore } from '#lib/stores/update-store.svelte.js';

/** How often an open page asks for a newer build, besides each time it comes back into view. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Page-lifetime; call once from the root layout. */
export async function installServiceWorker(): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	const { serviceWorker } = navigator;

	let registration: ServiceWorkerRegistration;
	try {
		// SvelteKit bundles the worker as an ES module.
		registration = await serviceWorker.register(`${resolve('/')}service-worker.js`, {
			type: 'module'
		});
	} catch (error) {
		logger.warn('Service worker:', String(error));
		return;
	}

	// A worker that installs while another controls the page is a newer build. Without a
	// controller it's the first install, which takes the page by itself.
	const offer = (worker: ServiceWorker) => {
		if (!serviceWorker.controller) return;
		updateStore.offer({
			kind: 'reload',
			apply: () => {
				serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
				worker.postMessage({ type: 'skip-waiting' });
			}
		});
	};
	if (registration.waiting) offer(registration.waiting);
	registration.addEventListener('updatefound', () => {
		const worker = registration.installing;
		worker?.addEventListener('statechange', () => {
			if (worker.state === 'installed') offer(worker);
		});
	});

	const check = () => void registration.update().catch(() => undefined);
	setInterval(check, CHECK_INTERVAL_MS);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') check();
	});
}
