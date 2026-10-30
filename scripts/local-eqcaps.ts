/**
 * `npm run dev:eqcaps` (`vite dev --mode eqcaps`): the dev server on eqcaps data built from a
 * local checkout, for devices and profiles not published yet. The checkout is `../eqcaps`, or
 * `EQCAPS_DIR`. Its `npm run data:build` output is served by the dev server itself at
 * `/__eqcaps/v1/` (same origin, so no CORS, and a phone on live reload reaches it too), and the
 * client is pointed there through `VITE_EQCAPS_URL`. A change under the checkout's `data/` builds
 * again and reloads the page. The build badge reads EQCAPS meanwhile.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const MODE = 'eqcaps';
const ROUTE = '/__eqcaps/v1/';

export function localEqcaps(): Plugin {
	const dir = resolve(process.env.EQCAPS_DIR ?? '../eqcaps');
	const site = join(dir, 'dist', 'site', 'v1');
	let building: Promise<boolean> | null = null;

	const build = () =>
		(building ??= new Promise<boolean>((done) => {
			const child = spawn('npm', ['run', 'data:build'], {
				cwd: dir,
				stdio: 'inherit',
				shell: true
			});
			child.on('error', () => done(false));
			child.on('exit', (code) => done(code === 0));
		}).finally(() => (building = null)));

	return {
		name: 'local-eqcaps',
		apply: (_config, env) => env.command === 'serve' && env.mode === MODE,
		config() {
			if (!existsSync(join(dir, 'package.json'))) {
				throw new Error(`no eqcaps checkout at ${dir}; set EQCAPS_DIR`);
			}
			// Read by Vite's env loading, which takes VITE_* from process.env too.
			process.env.VITE_EQCAPS_URL = ROUTE;
		},
		async configureServer(server) {
			if (!(await build())) throw new Error(`npm run data:build failed in ${dir}`);
			server.config.logger.info(`eqcaps data from ${site}, at ${ROUTE}`);

			let timer: ReturnType<typeof setTimeout> | undefined;
			const data = join(dir, 'data') + sep;
			server.watcher.add(data);
			server.watcher.on('all', (_event, file) => {
				if (!file.startsWith(data)) return;
				clearTimeout(timer);
				timer = setTimeout(async () => {
					if (await build()) server.ws.send({ type: 'full-reload' });
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
