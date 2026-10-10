#!/usr/bin/env node
// Renders resources/icon.svg into the PNGs that need it, with the Chromium Playwright already
// installs for the browser tests:
//
//   static/favicon.png             96 px, rounded corners (browser tabs show it as is)
//   static/apple-touch-icon.png    180 px, square (iOS rounds it)
//   resources/play-store-icon.png  512 px, square (Play applies its own mask)
//
//   npm run icons
//
// The Android launcher icons (android/app/src/main/res/mipmap-*) are not rendered from it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(join(root, 'resources', 'icon.svg'), 'utf8');

const targets = [
	{ file: 'static/favicon.png', size: 96, radius: 0.22 },
	{ file: 'static/apple-touch-icon.png', size: 180, radius: 0 },
	{ file: 'resources/play-store-icon.png', size: 512, radius: 0 }
];

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	for (const { file, size, radius } of targets) {
		// Through a canvas rather than a screenshot: toDataURL always writes 32-bit RGBA, which the
		// Play Console asks for, where a screenshot of an opaque page comes out 24-bit.
		const dataUrl = await page.evaluate(
			async ({ svg, size, radius }) => {
				const image = new Image();
				image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
				await image.decode();
				const canvas = Object.assign(document.createElement('canvas'), {
					width: size,
					height: size
				});
				const context = canvas.getContext('2d');
				context.beginPath();
				context.roundRect(0, 0, size, size, radius * size);
				context.clip();
				context.drawImage(image, 0, 0, size, size);
				return canvas.toDataURL('image/png');
			},
			{ svg, size, radius }
		);
		writeFileSync(join(root, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
		console.log(`✔ ${file} (${size} px)`);
	}
} finally {
	await browser.close();
}
