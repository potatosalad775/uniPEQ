/**
 * A newer version of the app, and how to get it; the shell's `UpdatePrompt` shows it until it's
 * taken or dismissed.
 *
 * - `reload`: the web build's service worker has the next build waiting (`#lib/platform/pwa.js`).
 *   Applying is the user's call: it reloads the page, which drops a device connection and the
 *   list's unwritten edits.
 * - `download`: a sideloaded APK and a newer GitHub release (`#lib/platform/release-updates.js`). The
 *   prompt links to the release; a dismissed version isn't offered again.
 */
export type Update =
	{ kind: 'reload'; apply: () => void } | { kind: 'download'; version: string; url: string };

const DISMISSED_KEY = 'unipeq.update.dismissed';

class UpdateStore {
	current = $state.raw<Update | null>(null);

	offer(update: Update): void {
		if (update.kind === 'download' && this.#dismissedVersion() === update.version) return;
		this.current = update;
	}

	apply(): void {
		const update = this.current;
		this.current = null;
		if (update?.kind === 'reload') update.apply();
	}

	/** Hides the prompt. A waiting build still applies on the next launch. */
	dismiss(): void {
		const update = this.current;
		this.current = null;
		if (update?.kind !== 'download') return;
		try {
			localStorage.setItem(DISMISSED_KEY, update.version);
		} catch {
			/* Storage blocked: it's offered again next launch. */
		}
	}

	#dismissedVersion(): string | null {
		try {
			return localStorage.getItem(DISMISSED_KEY);
		} catch {
			return null;
		}
	}
}

export const updateStore = new UpdateStore();
