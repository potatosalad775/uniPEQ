<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import { installNative, setSystemBarsDark } from '$lib/platform/native';
	import { settingsStore } from '$lib/stores/settings-store.svelte';
	import AppShell from '$lib/components/layout/AppShell.svelte';

	let { children } = $props();

	settingsStore.hydrate();

	onMount(() => {
		document.documentElement.lang = getLocale();
		installNative();
	});

	let firstTheme = true;
	$effect(() => {
		const dark = settingsStore.dark;
		const html = document.documentElement;
		setSystemBarsDark(dark);
		// app.html already applied the boot theme; only animate later switches.
		if (firstTheme) {
			firstTheme = false;
			html.classList.toggle('dark', dark);
			return;
		}
		html.classList.add('theme-transition');
		html.classList.toggle('dark', dark);
		const timer = setTimeout(() => html.classList.remove('theme-transition'), 350);
		return () => clearTimeout(timer);
	});
</script>

<AppShell>
	{@render children()}
</AppShell>
