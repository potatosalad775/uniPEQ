/**
 * The first-launch introduction (`IntroDialog`): opens once per install, and again from Settings.
 * Closing it any way (Get started, Skip, the scrim, Android back) counts as seen.
 */
const SEEN_KEY = 'unipeq.intro.seen';
/** Raise to show the intro again to everyone who saw an older one (a page worth seeing). */
const INTRO_VERSION = 1;

class IntroStore {
	open = $state(false);
	/** Opened by the first launch, not from Settings. */
	#auto = false;

	/** Opens the intro unless this version was seen. */
	showIfNew(storage: Storage = localStorage): void {
		try {
			if (Number(storage.getItem(SEEN_KEY)) >= INTRO_VERSION) return;
		} catch {
			// Storage can throw in locked-down WebViews: show it this once anyway.
		}
		this.#auto = true;
		this.open = true;
	}

	show(): void {
		this.#auto = false;
		this.open = true;
	}

	close(storage: Storage = localStorage): void {
		this.open = false;
		try {
			storage.setItem(SEEN_KEY, String(INTRO_VERSION));
		} catch {
			// Not remembered: it shows again next launch.
		}
	}

	/**
	 * A link's approval needs the screen: a first-launch intro is put off to the next launch,
	 * unseen. One opened from Settings stays.
	 */
	deferForLink(): void {
		if (this.#auto) this.open = false;
	}
}

export const introStore = new IntroStore();
