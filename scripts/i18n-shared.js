// Copied from modernGraphTool scripts/i18n-shared.js @ 7a7c9a7f.
/**
 * Shared helpers for the i18n scripts (check-translations.js, apply-translations.js).
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { format, resolveConfig } from 'prettier';

export const MESSAGES_DIR = join(import.meta.dirname, '..', 'messages');
export const BASE_LOCALE = 'en';
export const MISSING_PREFIX = '_missing_translations_';
export const INFO_KEY = '@@info';

/** @param {string} locale */
export const missingFileName = (locale) => `${MISSING_PREFIX}${locale}.json`;

/** @param {string} fileName @returns {Record<string, unknown>} */
export const readJson = (fileName) =>
	JSON.parse(readFileSync(join(MESSAGES_DIR, fileName), 'utf-8'));

/**
 * Formatted through Prettier with the repo config, so the output passes `npm run lint` as
 * written: `JSON.stringify` alone breaks every array across lines (plural `selectors`), which
 * Prettier collapses. The input stays indented because Prettier keeps an object expanded only
 * when its source already was.
 *
 * @param {string} fileName
 * @param {unknown} obj
 */
export const writeJson = async (fileName, obj) => {
	const path = join(MESSAGES_DIR, fileName);
	const options = { ...(await resolveConfig(path)), filepath: path };
	writeFileSync(path, await format(JSON.stringify(obj, null, '\t'), options));
};

/** Message keys only — drops `$schema` and `@@info` metadata. @param {object} obj */
export const messageKeys = (obj) =>
	Object.keys(obj).filter((k) => !k.startsWith('$') && !k.startsWith('@@'));

/**
 * Locales that Paraglide actually compiles — i.e. `messages/<locale>.json`, excluding the
 * `_missing_translations_*.json` staging files (Paraglide ignores those; it only reads the
 * locales listed in project.inlang/settings.json).
 */
export const listLocales = () =>
	readdirSync(MESSAGES_DIR)
		.filter((f) => f.endsWith('.json') && !f.startsWith(MISSING_PREFIX))
		.map((f) => f.replace(/\.json$/, ''));

/**
 * Locales registered in project.inlang/settings.json: the ones Paraglide compiles and ships.
 * @returns {string[]}
 */
export const listConfiguredLocales = () =>
	JSON.parse(readFileSync(join(MESSAGES_DIR, '..', 'project.inlang', 'settings.json'), 'utf-8'))
		.locales;

export const listMissingFiles = () =>
	readdirSync(MESSAGES_DIR).filter((f) => f.startsWith(MISSING_PREFIX) && f.endsWith('.json'));
