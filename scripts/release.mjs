#!/usr/bin/env node
// Cuts a release in one step: checks → `npm version` (commit + tag vX.Y.Z) → push → publish the
// GitHub release. Publishing starts .github/workflows/release.yml, which deploys the web app to
// GitHub Pages, uploads the Play bundle and attaches the sideload APK. Nothing is built here.
//
//   npm run release -- <patch | minor | major | X.Y.Z> [--prerelease] [--yes]
//
//   --prerelease  publish as a pre-release: Play still gets the bundle, but the website stays as it
//                 is and sideload installs aren't told (releases/latest skips pre-releases)
//   --yes         don't ask before pushing
//
// Needs a clean main that's up to date with origin, and the GitHub CLI signed in (`gh auth login`).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const bump = args.find((arg) => !arg.startsWith('--'));

/**
 * `shell: true` (needed on Windows to run npm.cmd) joins arguments with spaces and quotes nothing,
 * so `-m 'chore(release): v%s'` reached npm as two words. Quote what cmd would split or read.
 */
function shellArgs(commandArgs) {
	if (!windows) return commandArgs;
	return commandArgs.map((arg) =>
		/[\s"&()<>^|]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
	);
}

function fail(message) {
	console.error(`✖ ${message}`);
	process.exit(1);
}

/** Runs a command with its output on the terminal; exits on failure, with `hint` if given. */
function step(title, command, commandArgs, hint = '') {
	console.log(`\n▶ ${title}`);
	const result = spawnSync(command, shellArgs(commandArgs), {
		cwd: root,
		stdio: 'inherit',
		shell: windows
	});
	if (result.status !== 0) fail(`${title} failed${hint ? `\n  ${hint}` : ''}`);
}

/** A command's trimmed stdout, or null when it fails. */
function read(command, commandArgs) {
	const result = spawnSync(command, shellArgs(commandArgs), {
		cwd: root,
		encoding: 'utf8',
		shell: windows
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

function nextVersion(current) {
	if (/^\d+\.\d+\.\d+$/.test(bump ?? '')) return bump;
	const [major, minor, patch] = current.split('.').map(Number);
	if (bump === 'major') return `${major + 1}.0.0`;
	if (bump === 'minor') return `${major}.${minor + 1}.0`;
	if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
	fail('Usage: npm run release -- <patch | minor | major | X.Y.Z> [--prerelease] [--yes]');
}

const { version: current } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = nextVersion(current);
const tag = `v${version}`;
const [, minor, patch] = version.split('.').map(Number);
// android/app/build.gradle: versionCode = MAJOR*10000 + MINOR*100 + PATCH.
if (minor > 99 || patch > 99) fail(`${version}: the versionCode scheme needs MINOR and PATCH ≤ 99`);

// Everything that can stop a release, before anything changes.
if (read('git', ['branch', '--show-current']) !== 'main') fail('Release from main.');
if (read('git', ['status', '--porcelain', '--untracked-files=no'])) {
	fail('Commit or stash your changes first.');
}
if (read('gh', ['auth', 'status']) === null) fail('The GitHub CLI is not signed in: gh auth login');
step('Fetch origin', 'git', ['fetch', 'origin', 'main', '--tags']);
if (read('git', ['rev-list', '--count', 'HEAD..origin/main']) !== '0') {
	fail('main is behind origin/main: pull first.');
}
if (read('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null) {
	fail(`${tag} already exists.`);
}
step('Type check', 'npm', ['run', 'check']);
step('Tests', 'npm', ['test']);

console.log(
	`\nuniPEQ ${current} → ${version}${has('prerelease') ? ' (pre-release)' : ''}\n` +
		'Pushes the version commit and tag to origin and publishes the GitHub release, which\n' +
		(has('prerelease')
			? 'uploads the Play bundle and attaches the sideload APK (the website stays as it is).'
			: 'deploys the website, uploads the Play bundle and attaches the sideload APK.')
);
if (!has('yes')) {
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await prompt.question(`Release ${tag}? [y/N] `);
	prompt.close();
	if (!/^y(es)?$/i.test(answer.trim())) fail('Cancelled; nothing changed.');
}

step(`npm version ${version}`, 'npm', ['version', version, '-m', 'chore(release): v%s']);
const push = ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`];
const release = ['release', 'create', tag, '--verify-tag', '--generate-notes', '--title', tag];
if (has('prerelease')) release.push('--prerelease');
step('Push', 'git', push, `The version commit and ${tag} are local. Retry: git ${push.join(' ')}`);
step(
	'Publish the GitHub release',
	'gh',
	release,
	`${tag} is pushed. Retry: gh ${release.join(' ')}`
);

const repo = read('gh', ['repo', 'view', '--json', 'url', '--jq', '.url']);
console.log(
	`\n✔ ${tag} published. The release workflow builds it${repo ? `: ${repo}/actions` : '.'}`
);
