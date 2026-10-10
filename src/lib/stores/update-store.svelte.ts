/**
 * A newer build of the app is ready, and how to switch to it. The web build's service worker
 * offers one (`$lib/platform/pwa`); the shell's `UpdatePrompt` shows it until it's applied or
 * dismissed. Applying is always the user's call: it reloads the page, which drops a device
 * connection and the list's unwritten edits.
 */
class UpdateStore {
	/** An update is waiting and the prompt hasn't been dismissed. */
	ready = $state(false);
	#apply: (() => void) | null = null;

	offer(apply: () => void): void {
		this.#apply = apply;
		this.ready = true;
	}

	apply(): void {
		this.ready = false;
		this.#apply?.();
	}

	/** Hides the prompt for this page's lifetime; the update still applies on the next launch. */
	dismiss(): void {
		this.ready = false;
	}
}

export const updateStore = new UpdateStore();
