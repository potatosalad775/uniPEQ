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
import snapshotText from '$lib/data/eqcaps-bundle.json?raw';

/**
 * The eqcaps database client: EQ constraint profiles for hardware, matched to a connected device
 * by its USB / Bluetooth identity (rebuild decision 3).
 *
 * - `ttl: 0`: `index.json` is revalidated with its ETag on every launch (a 304 costs nothing), so a
 *   fixed or added profile reaches users without an app update.
 * - The cache lives in localStorage, so a launch without network still has the last index and
 *   every profile it fetched.
 * - `snapshot` is the embedded bundle (`npm run data:snapshot`), used only when neither the network
 *   nor the cache has an answer: an offline or CDN-down first launch.
 *
 * Reached only through dynamic `import()`, so neither the client nor the 160 KB snapshot is in the
 * boot bundle. The client never throws: failures resolve to null / no matches and are logged.
 */
let client: EqcapsClient | null = null;

export function eqcapsClient(): EqcapsClient {
	client ??= createClient({
		baseUrl: V1_URL,
		ttl: 0,
		store: persistentStore(),
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

/** For specs: drop the singleton. */
export function resetEqcapsClient(): void {
	client = null;
}
