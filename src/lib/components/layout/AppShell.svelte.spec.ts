import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page as browserPage } from 'vitest/browser';
import { createRawSnippet } from 'svelte';
import { dispatchBack } from '#lib/platform/back-button.js';
import AppShell from './AppShell.svelte';

const location = vi.hoisted(() => ({ route: { id: '/presets' as string | null } }));
const goto = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$app/state', () => ({ page: location }));
vi.mock('$app/navigation', () => ({ goto }));

// Layout (bottom bar vs side rail) isn't asserted here: component specs load no Tailwind.

const body = createRawSnippet(() => ({ render: () => '<p>Page body</p>' }));

describe('AppShell', () => {
	beforeEach(() => {
		goto.mockClear();
	});

	it('renders the three tabs and marks the current one', async () => {
		location.route.id = '/presets';
		render(AppShell, { children: body });

		const nav = browserPage.getByRole('navigation', { name: 'Sections' });
		await expect.element(nav).toBeVisible();
		await expect.element(nav.getByRole('link')).toHaveLength(3);
		await expect
			.element(browserPage.getByRole('link', { name: 'Presets' }))
			.toHaveAttribute('aria-current', 'page');
		await expect
			.element(browserPage.getByRole('link', { name: 'EQ' }))
			.not.toHaveAttribute('aria-current');
		await expect.element(browserPage.getByText('Page body')).toBeVisible();
	});

	it('sends back to the EQ tab from another tab, replacing history', async () => {
		location.route.id = '/settings';
		const { unmount } = await render(AppShell, { children: body });

		expect(dispatchBack()).toBe(true);
		expect(goto).toHaveBeenCalledWith('/', { replace: true });
		unmount();
	});

	it('declines back on the EQ tab, so the app goes to the background', async () => {
		location.route.id = '/';
		const { unmount } = await render(AppShell, { children: body });

		expect(dispatchBack()).toBe(false);
		expect(goto).not.toHaveBeenCalled();
		unmount();
	});
});
