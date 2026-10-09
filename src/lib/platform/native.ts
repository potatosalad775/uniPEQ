/**
 * Capacitor glue for the shell: the hardware back button and the system bar icon colour. Every
 * export is a no-op on the web, so callers don't branch on the platform.
 */
import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { HidSpikeOptions } from '$lib/transports/native/hid-spike';
import { dispatchBack } from './back-button';
import { isDebugBuild } from './build';

export const isNative = Capacitor.isNativePlatform();

let installed = false;

/** Page-lifetime; call once from the root layout. */
export function installNative(): void {
	if (!isNative || installed) return;
	installed = true;

	// Registering a listener turns off Capacitor's default (WebView history back). With nothing left
	// to close, background the app rather than finish it, so an open device connection survives.
	void App.addListener('backButton', () => {
		if (!dispatchBack()) void App.minimizeApp();
	});

	// Phase 0 USB HID spike (docs/rebuild-plan.md), driven by scripts/android-hid-spike.mjs. Not UI,
	// and not in a release.
	if (isDebugBuild) {
		Object.assign(window, {
			uniPeqHidSpike: (options?: HidSpikeOptions) =>
				import('$lib/transports/native/hid-spike').then((m) => m.runHidSpike(options))
		});
	}
}

/**
 * Capacitor draws the WebView under the system bars only on WebView 140+ (with
 * `viewport-fit=cover`, which app.html sets; see SystemBars.java). Older WebViews are laid out
 * inside the bars, which then show the Android theme's window background: light or dark with the
 * system setting, not with ours.
 */
const webViewMajor = Number(/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 0);
export const drawsUnderSystemBars = webViewMajor >= 140;

/**
 * Bar icons that contrast with what's behind them: our page (light icons on a dark theme and vice
 * versa), or the system-themed window background on an old WebView.
 */
export function setSystemBarsDark(dark: boolean): void {
	if (!isNative) return;
	const style = !drawsUnderSystemBars
		? SystemBarsStyle.Default
		: dark
			? SystemBarsStyle.Dark
			: SystemBarsStyle.Light;
	SystemBars.setStyle({ style }).catch(() => undefined);
}
