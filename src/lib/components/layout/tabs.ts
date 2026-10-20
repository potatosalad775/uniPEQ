import { Library, Settings, SlidersHorizontal } from '@lucide/svelte';
import type { Component } from 'svelte';
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import * as m from '#lib/paraglide/messages.js';

export interface Tab {
	/** Route path. The first tab is the home the back button returns to. */
	path: '/' | '/presets' | '/settings';
	href: ResolvedPathname;
	label: () => string;
	icon: Component;
}

export const TABS: readonly Tab[] = [
	{ path: '/', href: resolve('/'), label: m.nav_main, icon: SlidersHorizontal },
	{ path: '/presets', href: resolve('/presets'), label: m.nav_presets, icon: Library },
	{ path: '/settings', href: resolve('/settings'), label: m.nav_settings, icon: Settings }
];

/** The tab a pathname belongs to; unknown paths count as home. */
export function activeTab(pathname: string): Tab {
	const path = pathname.replace(/\/+$/, '') || '/';
	return TABS.find((tab) => tab.path === path) ?? TABS[0];
}
