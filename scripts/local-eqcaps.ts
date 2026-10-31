/**
 * The app on eqcaps built from a local checkout, for devices, profiles and handlers not published
 * yet. The checkout is `../eqcaps`, or `EQCAPS_DIR`; its `npm run data:build` output goes at
 * `/__eqcaps/v1/` on the app's own origin (no CORS, nothing on the LAN), and in the `eqcaps` mode
 * the client is pointed there through `VITE_EQCAPS_URL`. The build badge reads EQCAPS meanwhile.
 *
 * The packages come from the checkout's source too (their `eqcaps:source` exports), since a new
 * device usually needs data and handler changes together. Only Vite is redirected: package.json
 * and node_modules keep the published packages, so `npm run check` and the specs still type
 * against those, and a packed tarball is still the test of what a release would ship.
 *
 * - `npm run dev:eqcaps` (`vite dev --mode eqcaps`): the dev server serves it, a change under the
 *   checkout's `data/` builds again and reloads the page, and a source edit reloads like app code.
 * - `npm run android -- --eqcaps`: the web build in that mode, with the data copied into `dist/`,
 *   so the APK reads it from its own files.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { searchForWorkspaceRoot, type Alias, type Plugin } from 'vite';

export const EQCAPS_MODE = 'eqcaps';
/** Where the data is, on the app's origin; `dist/` holds it under the same path. */
export const EQCAPS_ROUTE = '/__eqcaps/v1/';

const dir = resolve(process.env.EQCAPS_DIR ?? '../eqcaps');
/** The checkout's built data. */
export const eqcapsSite = join(dir, 'dist', 'site', 'v1');

/** Each published package's entry points, by import specifier, mapped to the checkout's source. */
function sourceAliases(): Alias[] {
	return ['core', 'client', 'device-bridge'].flatMap((name) => {
		const pkg = join(dir, 'packages', name);
		const { exports } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf-8')) as {
			exports: Record<string, { 'eqcaps:source': string }>;
		};
		return Object.entries(exports).map(([sub, entry]) => {
			const id = `@potatosalad775/eqcaps-${name}${sub.slice(1)}`;
			// Exact matches: `-core` must not catch `-core/…`, nor `-device-bridge` its `/browser`.
			return { find: new RegExp(`^${id}$`), replacement: join(pkg, entry['eqcaps:source']) };
		});
	});
}

let building: Promise<boolean> | null = null;

/** Runs `npm run data:build` in the checkout; false if it failed. One at a time. */
export const buildEqcapsData = () =>
	(building ??= new Promise<boolean>((done) => {
		if (!existsSync(join(dir, 'package.json'))) {
			console.error(`no eqcaps checkout at ${dir}; set EQCAPS_DIR`);
			return done(false);
		}
		const child = spawn('npm', ['run', 'data:build'], { cwd: dir, stdio: 'inherit', shell: true });
		child.on('error', () => done(false));
		child.on('exit', (code) => done(code === 0));
	}).finally(() => (building = null)));

export function localEqcaps(): Plugin {
	const site = eqcapsSite;
	const ROUTE = EQCAPS_ROUTE;
	return {
		name: 'local-eqcaps',
		apply: (_config, env) => env.mode === EQCAPS_MODE,
		config() {
			// Read by Vite's env loading, which takes VITE_* from process.env too.
			process.env.VITE_EQCAPS_URL = EQCAPS_ROUTE;
			if (!existsSync(join(dir, 'package.json'))) {
				throw new Error(`no eqcaps checkout at ${dir}; set EQCAPS_DIR`);
			}
			return {
				resolve: { alias: sourceAliases() },
				// Setting `allow` drops Vite's own workspace root, so it goes back in by hand.
				server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), dir] } }
			};
		},
		async configureServer(server) {
			if (!(await buildEqcapsData())) throw new Error(`npm run data:build failed in ${dir}`);
			server.config.logger.info(`eqcaps data from ${site}, at ${ROUTE}`);

			let timer: ReturnType<typeof setTimeout> | undefined;
			const data = join(dir, 'data') + sep;
			server.watcher.add(data);
			server.watcher.on('all', (_event, file) => {
				if (!file.startsWith(data)) return;
				clearTimeout(timer);
				timer = setTimeout(async () => {
					if (await buildEqcapsData()) server.ws.send({ type: 'full-reload' });
				}, 300);
			});

			server.middlewares.use(ROUTE, async (req, res, next) => {
				const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
				const file = resolve(site, '.' + path);
				if (!file.startsWith(site + sep)) return next();
				try {
					const body = await readFile(file);
					res.setHeader('Content-Type', 'application/json');
					res.setHeader('Cache-Control', 'no-store');
					res.end(body);
				} catch {
					res.statusCode = 404;
					res.end();
				}
			});
		}
	};
}
