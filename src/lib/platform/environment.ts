/**
 * Whether this environment can reach a device, and if not, what to tell the user. Capability
 * decides (`'hid' in navigator`, or the app), so a Chromium browser we never heard of works; the
 * user agent only picks the advice:
 * - `android`: Android browsers have no WebHID (only WebUSB, which blocks the HID class). The app
 *   reaches HID natively, so: get the app.
 * - `ios`: no USB or Bluetooth APIs for browsers or WebViews. Nothing to install.
 * - `desktop`: Firefox, Safari or a Chromium with WebHID off. Open it in Chrome or Edge.
 */
import { isNative } from './native';

export type Environment = 'supported' | 'android' | 'ios' | 'desktop';

export function classifyEnvironment(env: {
	native: boolean;
	hid: boolean;
	userAgent: string;
	maxTouchPoints: number;
}): Environment {
	if (env.native || env.hid) return 'supported';
	if (/Android/i.test(env.userAgent)) return 'android';
	// iPadOS Safari reports itself as a Mac; a touch screen gives it away.
	if (
		/iPhone|iPad|iPod/.test(env.userAgent) ||
		(/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
	) {
		return 'ios';
	}
	return 'desktop';
}

export const environment: Environment =
	typeof navigator === 'undefined'
		? 'supported'
		: classifyEnvironment({
				native: isNative,
				hid: 'hid' in navigator,
				userAgent: navigator.userAgent,
				maxTouchPoints: navigator.maxTouchPoints ?? 0
			});

/** Where the Android app is downloaded. Google Play joins once the listing is live. */
export const ANDROID_DOWNLOAD_URL = 'https://github.com/potatosalad775/uniPEQ/releases/latest';
