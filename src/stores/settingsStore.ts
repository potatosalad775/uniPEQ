import { defineStore } from 'pinia';
import { logger } from '@/services/logger';

export type ThemeSetting = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'unipeq.settings';

interface SettingsState {
  theme: ThemeSetting;
  language: 'en' | 'ko';
  autoPushDelayMs: number;
  autoPushEnabled: boolean;
  verboseLogging: boolean;
}

function load(): SettingsState {
  const defaults: SettingsState = {
    theme: 'system',
    language: 'en',
    autoPushDelayMs: 1500,
    autoPushEnabled: true,
    verboseLogging: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => load(),
  actions: {
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state));
      logger.verbose = this.verboseLogging;
      this.applyTheme();
    },
    applyTheme() {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const dark = this.theme === 'dark' || (this.theme === 'system' && prefersDark);
      document.documentElement.classList.toggle('ion-palette-dark', dark);
    },
  },
});
