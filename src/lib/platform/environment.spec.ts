import { describe, expect, it } from 'vitest';
import { classifyEnvironment } from './environment';

const UA = {
	chromeWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	firefoxWindows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
	safariMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
	chromeAndroid:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
	firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'
};

function classify(userAgent: string, { hid = false, native = false, maxTouchPoints = 0 } = {}) {
	return classifyEnvironment({ native, hid, userAgent, maxTouchPoints });
}

describe('classifyEnvironment', () => {
	it('trusts WebHID and the app over the user agent', () => {
		expect(classify(UA.chromeWindows, { hid: true })).toBe('supported');
		expect(classify(UA.chromeAndroid, { native: true })).toBe('supported');
	});

	it('sends every Android browser to the app', () => {
		expect(classify(UA.chromeAndroid)).toBe('android');
		expect(classify(UA.firefoxAndroid)).toBe('android');
	});

	it('knows iPhones, and iPads that claim to be Macs', () => {
		expect(classify(UA.iphone, { maxTouchPoints: 5 })).toBe('ios');
		expect(classify(UA.safariMac, { maxTouchPoints: 5 })).toBe('ios');
	});

	it('sends other desktop browsers to Chrome or Edge', () => {
		expect(classify(UA.firefoxWindows)).toBe('desktop');
		expect(classify(UA.safariMac)).toBe('desktop');
	});
});
