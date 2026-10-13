import { logger } from '$lib/services/logger';

export type ThemeSetting = 'system' | 'light' | 'dark';

/** Same key and shape as the Vue prototype's settings, so a prototype install keeps its choices. */
export const SETTINGS_KEY = 'unipeq.settings';

export interface PersistedSettings {
	theme: ThemeSetting;
	autoPushEnabled: boolean;
	autoPushDelayMs: number;
	/** Ask the user to lower the volume before the first write to each connected device. */
	writeWarning: boolean;
	verboseLogging: boolean;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
	theme: 'system',
	autoPushEnabled: true,
	autoPushDelayMs: 1500,
	writeWarning: true,
	verboseLogging: false
};

/** Mirrored by the pre-paint script in src/app.html; keep the two in step. */
export function resolveDark(theme: ThemeSetting, systemDark: boolean): boolean {
	return theme === 'dark' || (theme === 'system' && systemDark);
}

/** Reads stored settings, keeping each field only if it has the right type. */
export function parseSettings(raw: string | null): PersistedSettings {
	const settings = { ...DEFAULT_SETTINGS };
	if (!raw) return settings;
	let stored: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return settings;
		stored = parsed as Record<string, unknown>;
	} catch {
		return settings;
	}
	if (stored.theme === 'system' || stored.theme === 'light' || stored.theme === 'dark') {
		settings.theme = stored.theme;
	}
	if (typeof stored.autoPushEnabled === 'boolean')
		settings.autoPushEnabled = stored.autoPushEnabled;
	if (typeof stored.autoPushDelayMs === 'number' && stored.autoPushDelayMs >= 0) {
		settings.autoPushDelayMs = stored.autoPushDelayMs;
	}
	if (typeof stored.writeWarning === 'boolean') {
		settings.writeWarning = stored.writeWarning;
	}
	if (typeof stored.verboseLogging === 'boolean') settings.verboseLogging = stored.verboseLogging;
	return settings;
}

class SettingsStore {
	theme = $state<ThemeSetting>(DEFAULT_SETTINGS.theme);
	autoPushEnabled = $state(DEFAULT_SETTINGS.autoPushEnabled);
	autoPushDelayMs = $state(DEFAULT_SETTINGS.autoPushDelayMs);
	writeWarning = $state(DEFAULT_SETTINGS.writeWarning);
	verboseLogging = $state(DEFAULT_SETTINGS.verboseLogging);
	/** The OS colour-scheme preference, tracked live for `theme: 'system'`. */
	systemDark = $state(false);
	dark = $derived(resolveDark(this.theme, this.systemDark));

	#hydrated = false;

	/** Loads saved settings and starts persisting changes. Idempotent; page-lifetime. */
	hydrate(storage: Storage = localStorage): void {
		if (this.#hydrated) return;
		this.#hydrated = true;

		let raw: string | null = null;
		try {
			raw = storage.getItem(SETTINGS_KEY);
		} catch {
			// Storage can throw in locked-down WebViews; run on defaults.
		}
		Object.assign(this, parseSettings(raw));

		const query = window.matchMedia('(prefers-color-scheme: dark)');
		this.systemDark = query.matches;
		query.addEventListener('change', (event) => (this.systemDark = event.matches));

		$effect.root(() => {
			$effect(() => {
				const snapshot: PersistedSettings = {
					theme: this.theme,
					autoPushEnabled: this.autoPushEnabled,
					autoPushDelayMs: this.autoPushDelayMs,
					writeWarning: this.writeWarning,
					verboseLogging: this.verboseLogging
				};
				logger.verbose = snapshot.verboseLogging;
				try {
					storage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
				} catch {
					// Not persisted this time; the in-memory value still applies.
				}
			});
		});
	}
}

export const settingsStore = new SettingsStore();
