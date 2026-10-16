import { Ban, Globe, Smartphone } from '@lucide/svelte';
import type { Component } from 'svelte';
import * as m from '$lib/paraglide/messages';
import type { Environment } from '$lib/platform/environment';

export interface EnvironmentCopy {
	title: string;
	body: string;
	icon: Component;
}

/** What an environment that can't reach a device is told; null where it can. */
export function environmentCopy(env: Environment): EnvironmentCopy | null {
	switch (env) {
		case 'android':
			return { title: m.env_android_title(), body: m.env_android_body(), icon: Smartphone };
		case 'ios':
			return { title: m.env_ios_title(), body: m.env_ios_body(), icon: Ban };
		case 'desktop':
			return { title: m.env_desktop_title(), body: m.env_desktop_body(), icon: Globe };
		case 'supported':
			return null;
	}
}
