import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { PLAY_NOTES_LIMIT, changelogNotes, parseChangelog, readChangelog } from './changelog.js';

const SAMPLE = `# CHANGELOG

## v1.1.0 [2026-10-13]
- Added a feature
- Fixed a bug

## v1.0.0 [2026-10-10]
- Initial release
`;

describe('parseChangelog', () => {
	it('reads each entry up to the next heading', () => {
		expect(parseChangelog(SAMPLE)).toEqual([
			{ version: '1.1.0', date: '2026-10-13', notes: '- Added a feature\n- Fixed a bug' },
			{ version: '1.0.0', date: '2026-10-10', notes: '- Initial release' }
		]);
	});

	it('reads CRLF files', () => {
		expect(changelogNotes(SAMPLE.replace(/\n/g, '\r\n'), '1.1.0')).toBe(
			'- Added a feature\n- Fixed a bug'
		);
	});

	it('throws on a heading it would otherwise skip', () => {
		expect(() => parseChangelog('## 1.0.0 [2026-10-10]\n- x')).toThrow(/isn't/);
		expect(() => parseChangelog('## v1.0.0 2026-10-10\n- x')).toThrow(/isn't/);
	});
});

describe('changelogNotes', () => {
	it('takes the version with or without its v', () => {
		expect(changelogNotes(SAMPLE, 'v1.0.0')).toBe('- Initial release');
		expect(changelogNotes(SAMPLE, '1.0.0')).toBe('- Initial release');
	});

	it('is null for a version without an entry', () => {
		expect(changelogNotes(SAMPLE, '1.2.0')).toBeNull();
	});
});

// The release script checks the version it tags; these keep the file itself releasable.
describe('CHANGELOG.md', () => {
	const entries = parseChangelog(readChangelog());

	it("has an entry for package.json's version", () => {
		const { version } = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8')
		);
		expect(entries.map((entry) => entry.version)).toContain(version);
	});

	it('has notes in every entry, short enough for Play, each version once', () => {
		for (const entry of entries) {
			expect(entry.notes, `v${entry.version}`).not.toBe('');
			expect(entry.notes.length, `v${entry.version}`).toBeLessThanOrEqual(PLAY_NOTES_LIMIT);
		}
		expect(new Set(entries.map((entry) => entry.version)).size).toBe(entries.length);
	});
});
