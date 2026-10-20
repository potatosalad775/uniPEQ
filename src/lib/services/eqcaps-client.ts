// Adapted from modernGraphTool src/lib/services/eqcaps-client.ts @ 23ddc4dd.
import {
	createClient,
	memoryStore,
	V1_URL,
	webStorageStore,
	type CacheStore,
	type EqcapsClient
} from '@potatosalad775/eqcaps-client';
import type { DataBundle } from '@potatosalad775/eqcaps-core';
import { logger } from './logger';
// As text, parsed on first use: a JSON import would make TypeScript infer the whole bundle's type.
import snapshotText from '#lib/data/eqcaps-bundle.json?raw';

/**
 * The eqcaps database client: EQ constraint profiles for hardware, matched to a connected device
 * by its USB / Bluetooth identity.
 *
 * - `ttl: 0`: every `loadIndex()` asks the network, so a fixed or added profile reaches users
 *   without an app update. GitHub Pages hides `ETag` from cross-origin reads, so the client sends no
 *   `If-None-Match`; the WebView's HTTP cache answers within the CDN's `max-age` (10 min) and
 *   revalidates with a near-free 304 after it.
 * - The cache lives in localStorage, so a launch without network still has the last index and
 *   every profile it fetched.
 * - `snapshot` is the embedded bundle (`npm run data:snapshot`), used only when neither the network
 *   nor the cache has an answer: an offline or CDN-down first launch.
 *
 * Reached only through dynamic `import()`, so neither the client nor the 160 KB snapshot is in the
 * boot bundle. The client never throws: failures resolve to null / no matches and are logged.
 */
let client: EqcapsClient | null = null;
let store: CacheStore | null = null;

export function eqcapsClient(): EqcapsClient {
	store ??= persistentStore();
	client ??= createClient({
		baseUrl: V1_URL,
		ttl: 0,
		store,
		snapshot: JSON.parse(snapshotText) as DataBundle,
		onError: (error, context) => logger.warn(`eqcaps (${context}):`, String(error))
	});
	return client;
}

function persistentStore(): CacheStore {
	try {
		if (typeof localStorage !== 'undefined') return webStorageStore(localStorage);
	} catch {
		/* Storage blocked. */
	}
	return memoryStore();
}

/**
 * When the index last came back from the network, ms since the epoch, or null if it never has (the
 * app is on the embedded snapshot). The client stamps `fetchedAt` on the cached entry after every
 * answer, a 304 included, and leaves it alone on a failure, so an old time means recent checks
 * failed.
 */
export async function indexCheckedAt(): Promise<number | null> {
	eqcapsClient();
	try {
		return (await store?.get('index'))?.fetchedAt ?? null;
	} catch {
		// A corrupt entry; the client treats it as a miss too.
		return null;
	}
}

/** For specs: drop the singleton. */
export function resetEqcapsClient(): void {
	client = null;
	store = null;
}
