import { describe, expect, it } from 'vitest';
import { isNewer, newerRelease, parseRelease } from './release-check';

const apk = { name: 'uniPEQ-1.3.0.apk', browser_download_url: 'https://example.test/a.apk' };
const body = (tag: string, assets: unknown[] = [apk]) => ({
	tag_name: tag,
	html_url: `https://github.com/potatosalad775/uniPEQ/releases/tag/${tag}`,
	assets
});
const respond =
	(status: number, json: unknown): typeof fetch =>
	async () =>
		new Response(JSON.stringify(json), { status });

describe('isNewer', () => {
	it('compares each part as a number', () => {
		expect(isNewer('1.10.0', '1.9.9')).toBe(true);
		expect(isNewer('v2.0.0', '1.99.99')).toBe(true);
		expect(isNewer('1.2.3', '1.2.3')).toBe(false);
		expect(isNewer('1.2.2', '1.2.3')).toBe(false);
	});

	it('is false for what does not parse', () => {
		expect(isNewer('latest', '1.0.0')).toBe(false);
		expect(isNewer('1.0.1', 'dev')).toBe(false);
	});
});

describe('parseRelease', () => {
	it('takes the version without the v and the release page', () => {
		expect(parseRelease(body('v1.3.0'))).toEqual({
			version: '1.3.0',
			url: 'https://github.com/potatosalad775/uniPEQ/releases/tag/v1.3.0'
		});
	});

	it('waits for the APK to be attached', () => {
		expect(parseRelease(body('v1.3.0', []))).toBeNull();
		expect(parseRelease(body('v1.3.0', [{ name: 'uniPEQ-1.3.0.aab' }]))).toBeNull();
	});

	it('rejects other shapes', () => {
		expect(parseRelease(null)).toBeNull();
		expect(parseRelease({ message: 'Not Found' })).toBeNull();
	});
});

describe('newerRelease', () => {
	it('offers a newer release', async () => {
		await expect(newerRelease('1.2.0', respond(200, body('v1.3.0')))).resolves.toMatchObject({
			version: '1.3.0'
		});
	});

	it('is null for the same version, an HTTP error or a network failure', async () => {
		await expect(newerRelease('1.3.0', respond(200, body('v1.3.0')))).resolves.toBeNull();
		await expect(newerRelease('1.2.0', respond(403, {}))).resolves.toBeNull();
		const offline: typeof fetch = async () => {
			throw new TypeError('Failed to fetch');
		};
		await expect(newerRelease('1.2.0', offline)).resolves.toBeNull();
	});
});
