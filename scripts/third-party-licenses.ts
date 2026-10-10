/**
 * `virtual:third-party-licenses`: uniPEQ's own LICENSE and the notices of everything the app ships,
 * for the Open-source licenses sheet in Settings.
 *
 * The npm side is read from the bundle, not from package.json: every module in the client build
 * that lives under node_modules names its package, and that package's license files are copied in.
 * So the list is what the app actually ships (svelte's runtime yes, its compiler no). The module
 * graph is only complete once the build ends, so the virtual module holds a placeholder that
 * `renderChunk` fills in. The dev server has no bundle: there `notices` is null.
 *
 * The Android side (Gradle dependencies, which the bundle can't see) is listed by hand below. Check
 * it against `android/gradlew -p android :app:dependencies --configuration releaseRuntimeClasspath`
 * when a native dependency or Capacitor plugin changes.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export interface Notice {
	name: string;
	version?: string;
	/** SPDX expression as the package declares it, or the license file's title line. */
	license: string;
	url?: string;
	/** What an entry that isn't one npm package covers. */
	note?: string;
	/** The license and notice files as shipped; empty when the package ships none. */
	text: string;
	/** Only in the Android app. */
	android?: boolean;
}

const ID = 'virtual:third-party-licenses';
const RESOLVED = `\0${ID}`;
const TOKEN = '__UNIPEQ_THIRD_PARTY_LICENSES__';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE_MODULES = '/node_modules/';

const local = (file: string) => readFileSync(path.join(ROOT, 'scripts/licenses', file), 'utf-8');

/** The package directory a module id sits in, or null for the app's own modules. */
export function packageRoot(id: string): string | null {
	const file = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0];
	const at = file.lastIndexOf(NODE_MODULES);
	if (at < 0) return null;
	const start = at + NODE_MODULES.length;
	const parts = file.slice(start).split('/');
	const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
	return file.slice(0, start) + name;
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)([.-].*)?$/i;

function licenseId(declared: unknown, text: string): string {
	if (typeof declared === 'string') return declared;
	if (declared && typeof declared === 'object' && 'type' in declared) return String(declared.type);
	// No `license` field: name it by the file's title line ("MIT License" → "MIT").
	const title =
		text
			.split('\n')
			.find((line) => line.trim())
			?.trim() ?? '';
	return title.replace(/^(\S+) License$/, '$1');
}

/** A package's notice from its package.json and license files. */
export function readPackage(dir: string): Notice {
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
	const files = (sub: string) =>
		existsSync(path.join(dir, sub))
			? readdirSync(path.join(dir, sub))
					.filter((file) => LICENSE_FILE.test(file))
					.sort()
					.map((file) => path.join(dir, sub, file))
			: [];
	// Some packages keep it beside their build output only (pretendard's dist/LICENSE.txt).
	const found = files('.');
	const text = (found.length > 0 ? found : files('dist'))
		.map((file) => readFileSync(file, 'utf-8').trim())
		.join('\n\n');
	const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
	return {
		name: pkg.name,
		version: pkg.version,
		license: licenseId(pkg.license ?? pkg.licenses?.[0], text),
		url: pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, ''),
		text
	};
}

/** One notice per package the module ids come from, by name. */
export function bundledPackages(moduleIds: Iterable<string>): Notice[] {
	const dirs = new Set<string>();
	for (const id of moduleIds) {
		const dir = packageRoot(id);
		if (dir && existsSync(path.join(dir, 'package.json'))) dirs.add(dir);
	}
	const byName = new Map<string, Notice>();
	for (const dir of dirs) {
		const notice = readPackage(dir);
		const key = `${notice.name}@${notice.version}`;
		if (!byName.has(key)) byName.set(key, notice);
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Not in the bundle's module graph: non-npm entries, and the native side of Capacitor and of every
 * Capacitor plugin no JS imports (`@capacitor/keyboard`), whose Android code is in the APK anyway.
 */
function extraNotices(bundled: Notice[]): Notice[] {
	const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
	const have = new Set(bundled.map((n) => n.name));
	const native = Object.keys(pkg.dependencies)
		.filter((name) => name.startsWith('@capacitor/') && !have.has(name))
		.sort()
		.map((name) => ({ ...readPackage(path.join(ROOT, 'node_modules', name)), android: true }));
	const apache = local('Apache-2.0.txt');
	return [
		{
			name: 'modernGraphTool',
			license: 'MIT',
			url: 'https://github.com/potatosalad775/modernGraphTool',
			note: 'UI components and the device panel are adapted from it.',
			text: local('modernGraphTool.txt')
		},
		{
			name: 'eqcaps device data',
			license: 'CC0-1.0',
			url: 'https://github.com/potatosalad775/eqcaps',
			note: 'The embedded device database (bundle.json).',
			text: local('CC0-1.0.txt')
		},
		...native,
		{
			name: 'ion-android-filesystem',
			version: '1.1.1',
			license: 'MIT',
			url: 'https://github.com/ionic-team/ion-android-filesystem',
			text: local('ionfilesystem-android.txt'),
			android: true
		},
		{
			name: 'Android libraries',
			license: 'Apache-2.0',
			note: [
				'AndroidX (androidx.*): https://developer.android.com/jetpack/androidx',
				'Apache Cordova Android framework: https://github.com/apache/cordova-android',
				'Kotlin standard library, kotlinx.coroutines and JetBrains annotations: https://kotlinlang.org',
				'Guava ListenableFuture: https://github.com/google/guava',
				'JSpecify: https://jspecify.dev'
			].join('\n'),
			text: `${local('cordova-android-NOTICE.txt').trim()}\n\n${apache}`,
			android: true
		}
	];
}

export function thirdPartyLicenses(): Plugin {
	let serve = false;
	return {
		name: 'unipeq:third-party-licenses',
		configResolved(config) {
			serve = config.command === 'serve';
		},
		resolveId(id) {
			return id === ID ? RESOLVED : undefined;
		},
		load(id) {
			if (id !== RESOLVED) return;
			const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf-8');
			const notices = serve ? 'null' : `JSON.parse(${JSON.stringify(TOKEN)})`;
			return `export const license = ${JSON.stringify(license)};\nexport const notices = ${notices};\n`;
		},
		renderChunk(code) {
			const token = new RegExp(`(["'\`])${TOKEN}\\1`);
			if (!token.test(code)) return null;
			const bundled = bundledPackages(this.getModuleIds());
			const notices = [...bundled, ...extraNotices(bundled)];
			// A function replacement, so `$` in a license text isn't read as a pattern.
			return {
				code: code.replace(token, () => JSON.stringify(JSON.stringify(notices))),
				map: null
			};
		}
	};
}
