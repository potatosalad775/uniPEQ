/**
 * Reads a version's entry from CHANGELOG.md, the one source of a release's notes: release.mjs
 * refuses to tag a version without one and publishes it as the GitHub release's notes (what the
 * sideload APK's update notice links to), and the release workflow hands it to Play as "What's
 * new". An entry is a `## vX.Y.Z [YYYY-MM-DD]` heading followed by its lines, up to the next `## `.
 *
 * Usage:
 *   node scripts/changelog.js <X.Y.Z>    prints the entry's notes; exits 1 when there is none
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

export const CHANGELOG_PATH = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

/** Play rejects release notes longer than this, per language. */
export const PLAY_NOTES_LIMIT = 500;

const HEADING = /^## v(\d+\.\d+\.\d+) \[(\d{4}-\d{2}-\d{2})\]\s*$/;

/**
 * The entries of a changelog, newest first as written. A `## ` line that isn't a well-formed
 * heading throws, so a typo can't hide an entry from the release.
 *
 * @param {string} text
 * @returns {{ version: string, date: string, notes: string }[]}
 */
export function parseChangelog(text) {
	/** @type {{ version: string, date: string, notes: string }[]} */
	const entries = [];
	/** @type {string[]} */
	let lines = [];
	const close = () => {
		const last = entries.at(-1);
		if (last) last.notes = lines.join('\n').trim();
		lines = [];
	};
	for (const line of text.split(/\r?\n/)) {
		if (!line.startsWith('## ')) {
			lines.push(line);
			continue;
		}
		const match = HEADING.exec(line);
		if (!match) throw new Error(`CHANGELOG.md: "${line}" isn't "## vX.Y.Z [YYYY-MM-DD]"`);
		close();
		entries.push({ version: match[1], date: match[2], notes: '' });
	}
	close();
	return entries;
}

/**
 * The notes of `version` (`1.2.3` or `v1.2.3`), or null when the changelog has no entry for it.
 *
 * @param {string} text
 * @param {string} version
 */
export function changelogNotes(text, version) {
	const wanted = version.replace(/^v/, '');
	return parseChangelog(text).find((entry) => entry.version === wanted)?.notes ?? null;
}

/** @param {string} [path] */
export function readChangelog(path = CHANGELOG_PATH) {
	return readFileSync(path, 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const version = process.argv[2];
	if (!version) {
		console.error('Usage: node scripts/changelog.js <X.Y.Z>');
		process.exit(1);
	}
	const notes = changelogNotes(readChangelog(), version);
	if (!notes) {
		console.error(`CHANGELOG.md has no entry for v${version.replace(/^v/, '')}`);
		process.exit(1);
	}
	console.log(notes);
}
