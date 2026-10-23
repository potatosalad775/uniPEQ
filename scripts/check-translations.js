// Copied from modernGraphTool scripts/check-translations.js @ 7a7c9a7f.
/**
 * Reports missing / stale keys in each messages/<locale>.json against the baseLocale (en).
 *
 * Missing keys are NOT a build error — Paraglide compiles them to a fallback on the baseLocale,
 * so a partial translation is fine and exits 0. It exits 1 only when messages/ and the locales
 * in project.inlang/settings.json disagree.
 *
 * Usage:
 *   node scripts/check-translations.js            # report only
 *   node scripts/check-translations.js --write    # also write messages/_missing_translations_<locale>.json
 */

import { unlinkSync } from 'fs';
import { join } from 'path';
import {
	MESSAGES_DIR,
	BASE_LOCALE,
	INFO_KEY,
	missingFileName,
	readJson,
	writeJson,
	messageKeys,
	listLocales,
	listConfiguredLocales
} from './i18n-shared.js';
import { pluralCategories, toShorthand, exactMatchSupported } from './i18n-plural.js';

const write = process.argv.includes('--write');

const base = readJson(`${BASE_LOCALE}.json`);
const baseKeys = messageKeys(base);
const baseKeySet = new Set(baseKeys);

const locales = listLocales().filter((l) => l !== BASE_LOCALE);

// A messages file and a settings.json entry are both needed for a locale to ship, so this is
// the one failure the script reports: with either half alone the language is silently missing
// or broken.
const configured = listConfiguredLocales();
const unregistered = listLocales().filter((l) => !configured.includes(l));
const fileless = configured.filter((l) => !listLocales().includes(l));
for (const l of unregistered) {
	console.error(
		`${l}: messages/${l}.json exists but project.inlang/settings.json doesn't list it.`
	);
}
for (const l of fileless) {
	console.error(`${l}: project.inlang/settings.json lists it but messages/${l}.json is missing.`);
}
if (unregistered.length > 0 || fileless.length > 0) process.exitCode = 1;

const info = (locale) => [
	`Prefer translating in your browser? Fink edits messages/${locale}.json directly — no code or git:`,
	`  https://fink.inlang.com/?repo=potatosalad775/uniPEQ&project=project.inlang`,
	`  Walkthrough: https://github.com/potatosalad775/uniPEQ/blob/main/CONTRIBUTING.md#translating`,
	`This file is the offline alternative.`,
	``,
	`Keys that exist in <${BASE_LOCALE}> but not in <${locale}>.`,
	`The values below are the ${BASE_LOCALE} source text — replace them with ${locale} translations.`,
	`You do not have to translate all of them; leave out what you are unsure about and open a PR.`,
	`A maintainer then runs 'npm run i18n:apply' to merge this file into messages/${locale}.json.`,
	`Anything still missing afterwards simply renders in ${BASE_LOCALE} at runtime.`,
	``,
	...pluralHelp(locale)
];

const pluralHelp = (locale) => {
	const forms = pluralCategories(locale);
	if (forms.length === 1) {
		return [`Plurals — ${locale} has a single form, so "{count} band(s)" needs just one sentence.`];
	}
	return [
		`Plurals — ${locale} uses the forms: ${forms.join(', ')}. "other" is required.`,
		`Whole sentence: "key": { "one": "{count} band", "few": "{count} bands", "other": "..." }`,
		`  (add "plural": "total" to count another input instead of {count}).`,
		`Inside a sentence, # is the number: "Read {count, plural, one {# band} other {# bands}}"`,
		...(exactMatchSupported()
			? [`An exact number like "=0": "No bands" beats the forms above.`]
			: [])
	];
};

let anyGaps = false;

for (const locale of locales) {
	const target = readJson(`${locale}.json`);
	const targetKeys = new Set(messageKeys(target));

	const missing = baseKeys.filter((k) => !targetKeys.has(k));
	const stale = [...targetKeys].filter((k) => !baseKeySet.has(k));
	const fileName = missingFileName(locale);

	if (missing.length === 0 && stale.length === 0) {
		// Locale caught up — drop any stale staging file left over from a previous run.
		if (write) {
			try {
				unlinkSync(join(MESSAGES_DIR, fileName));
				console.log(`${locale}: in sync — removed ${fileName}`);
			} catch {
				// no staging file to clean up
			}
		}
		continue;
	}

	anyGaps = true;
	console.log(`\n${locale}:`);

	if (missing.length > 0) {
		console.log(`  missing (${missing.length}, falls back to ${BASE_LOCALE}):`);
		for (const k of missing) console.log(`    - ${k}`);

		if (write) {
			const stub = { [INFO_KEY]: info(locale) };
			// An en plural is offered in the shorthand translators edit, when it fits one.
			for (const k of missing) stub[k] = toShorthand(base[k]) ?? base[k];
			await writeJson(fileName, stub);
			console.log(`  -> wrote messages/${fileName}`);
		}
	}

	if (stale.length > 0) {
		console.log(`  stale (${stale.length}, not in ${BASE_LOCALE}, safe to remove):`);
		for (const k of stale) console.log(`    - ${k}`);
	}
}

if (!anyGaps) {
	console.log(`All locales in sync with ${BASE_LOCALE}.`);
} else if (!write) {
	console.log(`\nRun 'npm run i18n:missing' to write the gaps into editable stub files.`);
}
