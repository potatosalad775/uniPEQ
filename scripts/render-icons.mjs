#!/usr/bin/env node
// Renders resources/icon.svg into the PNGs that need it, with the Chromium Playwright already
// installs for the browser tests:
//
//   static/favicon.png             96 px, rounded corners (browser tabs show it as is)
//   static/apple-touch-icon.png    180 px, square (iOS rounds it)
//   static/icon-192.png            192 px, rounded (web app manifest, `any`)
//   static/icon-512.png            512 px, rounded (web app manifest, `any`)
//   static/icon-maskable-512.png   512 px, square (web app manifest, `maskable`: the mark sits
//                                  inside the 80 % safe zone, so the launcher's mask can't clip it)
//   resources/play-store-icon.png  512 px, square (Play applies its own mask)
//   android/app/src/main/res/mipmap-<density>/
//     ic_launcher_foreground.png   108 dp, the mark alone on the adaptive icon's whole layer (its
//                                  background is res/drawable/ic_launcher_background.xml)
//     ic_launcher.png              48 dp, rounded square (launchers before API 26)
//     ic_launcher_round.png        48 dp, circle (launchers before API 26)
//
//   npm run icons
//
// The splash icon (res/drawable/splash_icon.xml) is the same mark redrawn as a vector drawable.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(join(root, 'resources', 'icon.svg'), 'utf8');
// The adaptive icon's foreground: no background, and the full 108 dp layer, of which the
// launcher shows the centre 72 dp that icon.svg's viewBox covers.
const foreground = svg
	.replace(/<rect id="background"[^>]*\/>/, '')
	.replace('viewBox="-36 -36 72 72"', 'viewBox="-54 -54 108 108"');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const res = 'android/app/src/main/res';

// `inset` is the margin on each side, as a fraction of the size: a legacy launcher icon draws its
// 44 dp shape inside a 48 dp square.
const targets = [
	{ file: 'static/favicon.png', size: 96, radius: 0.22 },
	{ file: 'static/apple-touch-icon.png', size: 180, radius: 0 },
	{ file: 'static/icon-192.png', size: 192, radius: 0.22 },
	{ file: 'static/icon-512.png', size: 512, radius: 0.22 },
	{ file: 'static/icon-maskable-512.png', size: 512, radius: 0 },
	{ file: 'resources/play-store-icon.png', size: 512, radius: 0 },
	...Object.entries(densities).flatMap(([density, scale]) => [
		{
			file: `${res}/mipmap-${density}/ic_launcher_foreground.png`,
			size: 108 * scale,
			radius: 0,
			svg: foreground
		},
		{
			file: `${res}/mipmap-${density}/ic_launcher.png`,
			size: 48 * scale,
			radius: 0.18,
			inset: 2 / 48
		},
		{
			file: `${res}/mipmap-${density}/ic_launcher_round.png`,
			size: 48 * scale,
			radius: 0.5,
			inset: 2 / 48
		}
	])
];

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	for (const { file, size, radius, inset = 0, svg: source = svg } of targets) {
		// Through a canvas rather than a screenshot: toDataURL always writes 32-bit RGBA, which the
		// Play Console asks for, where a screenshot of an opaque page comes out 24-bit.
		const dataUrl = await page.evaluate(
			async ({ svg, size, radius, inset }) => {
				const image = new Image();
				image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
				await image.decode();
				const canvas = Object.assign(document.createElement('canvas'), {
					width: size,
					height: size
				});
				const context = canvas.getContext('2d');
				const margin = inset * size;
				const side = size - 2 * margin;
				context.beginPath();
				context.roundRect(margin, margin, side, side, radius * side);
				context.clip();
				context.drawImage(image, margin, margin, side, side);
				return canvas.toDataURL('image/png');
			},
			{ svg: source, size, radius, inset }
		);
		writeFileSync(join(root, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
		console.log(`✔ ${file} (${size} px)`);
	}
} finally {
	await browser.close();
}
