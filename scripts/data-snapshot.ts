/**
 * Refreshes the embedded eqcaps snapshot: downloads the published
 * `bundle.json` into src/lib/data/eqcaps-bundle.json. The app only falls back to it on an offline
 * or CDN-down first launch; run before each release (`npm run data:snapshot`), never during a build.
 *
 * Every profile is checked with core's `validateProfile`, so a broken or newer-format bundle is
 * refused here rather than shipped.
 */
import { SCHEMA_VERSION, validateProfile, type DataBundle } from '@potatosalad775/eqcaps-core';
import { V1_URL } from '@potatosalad775/eqcaps-client';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/lib/data/eqcaps-bundle.json', import.meta.url));
const url = new URL('bundle.json', process.env.EQCAPS_URL ?? V1_URL);

const response = await fetch(url);
if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
const text = await response.text();
const bundle = JSON.parse(text) as DataBundle;

const major = (version: string) => version.split('.')[0];
if (major(bundle.schemaVersion) !== major(SCHEMA_VERSION)) {
	throw new Error(`bundle schemaVersion ${bundle.schemaVersion}, this app reads ${SCHEMA_VERSION}`);
}
if (!Array.isArray(bundle.profiles) || bundle.profiles.length === 0) {
	throw new Error('bundle has no profiles');
}
const problems = bundle.profiles.flatMap((profile) =>
	validateProfile(profile)
		.filter((issue) => issue.severity === 'error')
		.map((issue) => `${profile.id}: ${issue.path} ${issue.message}`)
);
if (problems.length > 0) throw new Error(`invalid profiles:\n${problems.join('\n')}`);

await writeFile(OUT, text.endsWith('\n') ? text : `${text}\n`);
console.log(
	`Wrote ${bundle.profiles.length} profiles (data ${bundle.dataVersion}, ${bundle.generatedAt}) to src/lib/data/eqcaps-bundle.json`
);
