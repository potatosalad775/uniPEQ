/**
 * Asks GitHub for the latest uniPEQ release, for the sideloaded APK (`distribution === 'github'`):
 * Play updates its own installs, and the web build has its service worker. Pre-releases and
 * drafts are never "latest". A release counts once its APK is attached, which the release workflow
 * does a few minutes after publishing.
 */
import { logger } from './logger';

const LATEST_URL = 'https://api.github.com/repos/potatosalad775/uniPEQ/releases/latest';

export interface Release {
	version: string;
	/** The release page: its notes and the APK. */
	url: string;
}

/** `[major, minor, patch]` of `1.2.3` or `v1.2.3`, or null. */
function parseVersion(text: string): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** `candidate` is a higher version than `current`; false when either doesn't parse. */
export function isNewer(candidate: string, current: string): boolean {
	const a = parseVersion(candidate);
	const b = parseVersion(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

/** Reads a `releases/latest` response; null unless it has a version and an APK. */
export function parseRelease(body: unknown): Release | null {
	if (!body || typeof body !== 'object') return null;
	const { tag_name, html_url, assets } = body as Record<string, unknown>;
	if (typeof tag_name !== 'string' || typeof html_url !== 'string') return null;
	const hasApk =
		Array.isArray(assets) &&
		assets.some((asset) => typeof asset?.name === 'string' && asset.name.endsWith('.apk'));
	const version = parseVersion(tag_name);
	return hasApk && version ? { version: version.join('.'), url: html_url } : null;
}

/** The latest release if it's newer than `current`, else null. Never throws. */
export async function newerRelease(
	current: string,
	fetcher: typeof fetch = fetch
): Promise<Release | null> {
	try {
		const response = await fetcher(LATEST_URL, {
			headers: { Accept: 'application/vnd.github+json' }
		});
		if (!response.ok) {
			logger.warn(`Release check: HTTP ${response.status}`);
			return null;
		}
		const release = parseRelease(await response.json());
		return release && isNewer(release.version, current) ? release : null;
	} catch (error) {
		logger.warn('Release check:', String(error));
		return null;
	}
}
