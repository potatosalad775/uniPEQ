import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { linkStore, type LinkApproval } from '#lib/link/link-store.svelte.js';
import LinkBatteryDialog from './LinkBatteryDialog.svelte';

describe('LinkBatteryDialog', () => {
	afterEach(() => {
		linkStore.batteryTip = false;
		linkStore.approval = null;
	});

	it('shows the tip, and Not now puts it away', async () => {
		render(LinkBatteryDialog);
		linkStore.batteryTip = true;
		const dialog = page.getByRole('dialog', { name: 'Keep the link running' });
		await expect.element(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Not now' }).click();
		expect(linkStore.batteryTip).toBe(false);
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it('waits while "Link with …?" is open', async () => {
		render(LinkBatteryDialog);
		linkStore.approval = { host: 'squig.link', replaces: null } as unknown as LinkApproval;
		linkStore.batteryTip = true;
		const dialog = page.getByRole('dialog', { name: 'Keep the link running' });
		await expect.element(dialog).not.toBeInTheDocument();
		linkStore.approval = null;
		await expect.element(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Battery settings' }).click();
		expect(linkStore.batteryTip).toBe(false);
	});
});
