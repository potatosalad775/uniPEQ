#!/usr/bin/env node
// Builds the signed release bundle for Google Play, in one step:
// release web build → `cap sync android` → Gradle `bundleRelease` (and `assembleRelease` with --apk).
//
//   npm run android:release -- [--apk] [--skip-web]
//
//   --apk       also build a signed APK (to sideload or attach to a GitHub release)
//   --skip-web  reuse the last web build in dist/ (only native code changed). Make sure it was a
//               release build: a debug-mode one ships the demo device and the DEBUG badge.
//
// Signing comes from android/key.properties (see android/key.properties.example); the release
// workflow writes it from repository secrets. The version is package.json's (`npm version …`),
// which android/app/build.gradle turns into versionName and versionCode.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);

/** Runs a command with its output on the terminal; exits on failure. */
function step(title, command, commandArgs, options = {}) {
	console.log(`\n▶ ${title}`);
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		stdio: 'inherit',
		shell: windows, // npm/npx/gradlew.bat are .cmd/.bat files on Windows
		...options
	});
	if (result.status !== 0) {
		console.error(`\n✖ ${title} failed`);
		process.exit(result.status ?? 1);
	}
}

// Fail before a minute of building: an unsigned bundle can't be uploaded.
if (!existsSync(join(root, 'android', 'key.properties'))) {
	console.error(
		'✖ android/key.properties is missing. Copy android/key.properties.example and fill in the\n' +
			'  keystore path, alias and passwords.'
	);
	process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
console.log(`uniPEQ ${version}`);

if (!has('skip-web')) step('Web build (release)', 'npm', ['run', 'build']);
step('Capacitor sync', 'npx', ['cap', 'sync', 'android']);
const tasks = has('apk') ? ['bundleRelease', 'assembleRelease'] : ['bundleRelease'];
step(`Gradle ${tasks.join(' ')}`, windows ? 'gradlew.bat' : './gradlew', tasks, {
	cwd: join(root, 'android')
});

const outputs = join(root, 'android', 'app', 'build', 'outputs');
const built = [join(outputs, 'bundle', 'release', 'app-release.aab')];
if (has('apk')) built.push(join(outputs, 'apk', 'release', 'app-release.apk'));
console.log(`\n✔ uniPEQ ${version}`);
for (const file of built) console.log(`  ${relative(root, file)}`);
