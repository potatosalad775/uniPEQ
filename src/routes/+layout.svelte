<script lang="ts">
	// Pretendard Variable, bundled (no CDN): split by unicode-range, so a page fetches only the
	// subsets its text uses.
	import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
	import './layout.css';
	import { onMount } from 'svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import { appState } from '$lib/platform/app-state.svelte';
	import { distribution } from '$lib/platform/build';
	import { installNative, isNative, setSystemBarsDark } from '$lib/platform/native';
	import { settingsStore } from '$lib/stores/settings-store.svelte';
	import AppShell from '$lib/components/layout/AppShell.svelte';

	let { children } = $props();

	settingsStore.hydrate();

	onMount(() => {
		document.documentElement.lang = getLocale();
		installNative();
		appState.install();
		// Web: offline cache and the update prompt. The APK carries its own files.
		if (!isNative && !import.meta.env.DEV) {
			void import('$lib/platform/pwa').then((mod) => mod.installServiceWorker());
		}
		// Sideloaded APK: notices of newer GitHub releases. Play updates its own installs.
		if (isNative && distribution === 'github') {
			void import('$lib/platform/release-updates').then((mod) => mod.installReleaseUpdates());
		}
		// Revalidate the eqcaps index in the background, so a connect finds it ready.
		void import('$lib/services/eqcaps-client').then((mod) => mod.eqcapsClient().loadIndex());
		// Android: plugging a device in connects it, unplugging it disconnects.
		if (isNative) {
			void import('$lib/services/device-peq-service.svelte').then((mod) =>
				mod.devicePeqService.watchUsb()
			);
			// The modernGraphTool link: the room a cold start was opened with, and later links.
			void import('$lib/link/link-store.svelte').then((mod) => mod.loadLinkService());
		}
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
