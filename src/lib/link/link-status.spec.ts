import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '#lib/device-peq/sync-status.js';
import { linkStatus, statusLine, type LinkInput } from './link-status';

const link = (l: Partial<LinkInput>): LinkInput => ({
	state: 'idle',
	host: 'squig.link',
	goBack: false,
	...l
});

describe('linkStatus', () => {
	it('says nothing without a link, or once it is linked and steady', () => {
		expect(linkStatus(link({}))).toBeNull();
		expect(linkStatus(link({ state: 'linked' }))).toBeNull();
		expect(linkStatus(link({ state: 'ended' }))).toBeNull();
	});

	it('speaks while it waits on something', () => {
		expect(linkStatus(link({ state: 'joining' }))).toMatchObject({ tone: 'busy', link: true });
		expect(linkStatus(link({ state: 'approval' }))?.text).toContain('squig.link');
		expect(linkStatus(link({ state: 'waiting' }))).toMatchObject({ tone: 'muted' });
		expect(linkStatus(link({ state: 'joining', goBack: true }))).toMatchObject({
			tone: 'warning'
		});
	});
});

describe('statusLine', () => {
	const waiting = linkStatus(link({ state: 'waiting' }));
	const synced: SyncStatus = { tone: 'success', text: 'In sync' };
	const disconnected: SyncStatus = { tone: 'warning', text: 'Gone', actions: ['connect'] };

	it("is the device's without a link line", () => {
		expect(statusLine(synced, null)).toBe(synced);
		expect(statusLine(null, null)).toBeNull();
	});

	it("puts the link's over the device's routine news, under a device that needs the user", () => {
		expect(statusLine(synced, waiting)).toBe(waiting);
		expect(statusLine(null, waiting)).toBe(waiting);
		expect(statusLine(disconnected, waiting)).toBe(disconnected);
		expect(statusLine({ tone: 'error', text: 'Failed' }, waiting)?.text).toBe('Failed');
	});
});
