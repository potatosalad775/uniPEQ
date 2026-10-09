#!/usr/bin/env node
// Builds the debug app and installs it on a connected phone or emulator, in one step:
// web build → `cap sync android` → Gradle `assembleDebug` → `adb install -r` → launch.
//
//   npm run android -- [--serial <id>] [--skip-web] [--no-launch]
//
//   --serial <id>  the adb device to use when several are connected (`adb devices` lists them)
//   --skip-web     reuse the last web build in dist/ (only native code changed)
//   --no-launch    install without starting the app
//
// Needs the Android SDK (ANDROID_HOME, ANDROID_SDK_ROOT or android/local.properties) and adb.
// Gradle picks its own JDK (Zulu 21, see CLAUDE.md), so JAVA_HOME doesn't matter.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'kr.potatosalad775.unipeq';
const root = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
let serial = flag('serial') ?? process.env.ANDROID_SERIAL;

function sdkDir() {
	const fromEnv = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
	if (fromEnv) return fromEnv;
	const props = join(root, 'android', 'local.properties');
	if (existsSync(props)) {
		const line = readFileSync(props, 'utf8')
			.split(/\r?\n/)
			.find((l) => l.startsWith('sdk.dir='));
		// local.properties escapes `:` and `\` on Windows.
		if (line) return line.slice('sdk.dir='.length).replace(/\\(.)/g, '$1');
	}
	const home = process.env.HOME ?? '';
	const guesses = [
		join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
		join(home, 'Library', 'Android', 'sdk'),
		join(home, 'Android', 'Sdk')
	];
	return guesses.find((dir) => existsSync(dir));
}

const sdk = sdkDir();
const sdkAdb = sdk && join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb');
const adbPath = sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb';
const adb = (...a) =>
	execFileSync(adbPath, [...(serial ? ['-s', serial] : []), ...a], { encoding: 'utf8' }).trim();

/** Runs a command with its output on the terminal; exits on failure. */
function step(title, command, commandArgs, options = {}) {
	console.log(`\n▶ ${title}`);
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		stdio: 'inherit',
		shell: windows, // npm/npx/gradlew.bat are .cmd/.bat files on Windows
		...options,
		env: { ...process.env, ...(sdk ? { ANDROID_HOME: sdk } : {}), ...options.env }
	});
	if (result.status !== 0) {
		console.error(`\n✖ ${title} failed`);
		process.exit(result.status ?? 1);
	}
}

// Pick the device first, so a missing phone fails before a minute of building.
let devices;
try {
	devices = execFileSync(adbPath, ['devices'], { encoding: 'utf8' })
		.split(/\r?\n/)
		.slice(1)
		.map((line) => line.trim().split(/\s+/))
		.filter(([id, state]) => id && state === 'device')
		.map(([id]) => id);
} catch {
	console.error(`✖ adb not found (looked for ${adbPath}). Install the Android SDK platform-tools.`);
	process.exit(1);
}
if (serial && !devices.includes(serial)) {
	console.error(`✖ ${serial} is not connected. Connected: ${devices.join(', ') || 'none'}`);
	process.exit(1);
}
if (!serial) {
	if (devices.length === 0) {
		console.error(
			'✖ No device. Plug in a phone with USB debugging on, pair one over Wi-Fi\n' +
				'  (`adb pair` / `adb connect`), or start an emulator.'
		);
		process.exit(1);
	}
	if (devices.length > 1) {
		console.error(`✖ Several devices: ${devices.join(', ')}. Pick one with --serial <id>.`);
		process.exit(1);
	}
	serial = devices[0];
}
console.log(`Device: ${serial} (${adb('shell', 'getprop', 'ro.product.model')})`);

// Debug mode: the demo device and the DEBUG badge, as in `npm run dev` (src/lib/platform/build.ts).
if (!has('skip-web')) step('Web build', 'npm', ['run', 'build', '--', '--mode', 'debug']);
step('Capacitor sync', 'npx', ['cap', 'sync', 'android']);
step('Gradle assembleDebug', windows ? 'gradlew.bat' : './gradlew', ['assembleDebug'], {
	cwd: join(root, 'android')
});

const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
step('Install', adbPath, ['-s', serial, 'install', '-r', apk]);

if (!has('no-launch')) {
	adb('shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`);
	console.log(`\n✔ Installed and started ${APP_ID} on ${serial}`);
} else {
	console.log(`\n✔ Installed ${APP_ID} on ${serial}`);
}
