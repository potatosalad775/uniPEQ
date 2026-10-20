import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { logger } from '#lib/services/logger.js';
import LogDialog from './LogDialog.svelte';

describe('LogDialog', () => {
	beforeEach(() => logger.clear());

	it('shows the log and clears it', async () => {
		logger.info('connected Demo DAC');
		render(LogDialog, { open: true });
		const dialog = page.getByRole('dialog', { name: 'Log (1 entries)' });
		await expect.element(dialog.getByText(/\[info\] connected Demo DAC/)).toBeVisible();

		await dialog.getByRole('button', { name: 'Clear' }).click();
		await expect.element(page.getByRole('dialog', { name: 'Log (0 entries)' })).toBeVisible();
		await expect.element(page.getByText('(empty)')).toBeVisible();
	});
});
