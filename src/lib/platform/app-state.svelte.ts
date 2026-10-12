/**
 * Whether the app is in front, from Capacitor's `appStateChange` (the activity's resume and pause
 * on Android, `visibilitychange` on the web). Not `document.visibilityState`: while the
 * modernGraphTool link keeps the WebView "visible" in the background, that stays `visible`.
 */
import { App } from '@capacitor/app';

type Listener = (active: boolean) => void;

class AppState {
	/** The app is in front. */
	active = $state(true);
	#listeners = new Set<Listener>();
	#installed = false;

	/** Page-lifetime; call once from the root layout. */
	install(): void {
		if (this.#installed) return;
		this.#installed = true;
		void App.getState()
			.then(({ isActive }) => this.#set(isActive))
			.catch(() => {});
		void App.addListener('appStateChange', ({ isActive }) => this.#set(isActive));
	}

	/** Called on every change. Returns the unsubscribe. */
	on(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#set(active: boolean): void {
		if (active === this.active) return;
		this.active = active;
		// Animations would keep the compositor busy in a background kept "visible" (layout.css).
		document.documentElement.toggleAttribute('data-background', !active);
		for (const listener of [...this.#listeners]) listener(active);
	}
}

export const appState = new AppState();
