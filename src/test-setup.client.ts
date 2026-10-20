/**
 * Pins the UI language for component tests. Chromium inherits the host's system locale and
 * Paraglide's `preferredLanguage` strategy follows it, so on a Korean machine every spec that
 * queries an English string would match nothing. Written straight to localStorage (first in the
 * strategy order): importing `#lib/paraglide/runtime.js` here would cache the real module before
 * a spec's `vi.mock` could intercept it. Key and value track `localStorageKey` / `baseLocale` in
 * the generated runtime. (From modernGraphTool's src/test-setup.client.ts.)
 */
localStorage.setItem('PARAGLIDE_LOCALE', 'en');
