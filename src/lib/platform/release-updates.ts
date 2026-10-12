/**
 * Update notices for the sideloaded APK (`distribution === 'github'`): Play updates its own
 * installs, and nothing else updates this one. Checks GitHub at launch and when the app comes back
 * into view, at most every few hours (the API allows 60 unauthenticated requests an hour).
 */
import { newerRelease } from '$lib/services/release-check';
import { appState } from './app-state.svelte';
import { updateStore } from '$lib/stores/update-store.svelte';

const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastCheck = -Infinity;

async function check(): Promise<void> {
	if (Date.now() - lastCheck < MIN_INTERVAL_MS) return;
	lastCheck = Date.now();
	const release = await newerRelease(__APP_VERSION__);
	if (release) updateStore.offer({ kind: 'download', ...release });
}

/** Page-lifetime; call once from the root layout. */
export function installReleaseUpdates(): void {
	void check();
	appState.on((active) => {
		if (active) void check();
	});
}
