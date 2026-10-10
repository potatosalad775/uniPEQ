<script lang="ts">
	// Pretendard Variable, bundled (no CDN): split by unicode-range, so a page fetches only the
	// subsets its text uses.
	import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
	import './layout.css';
	import { onMount } from 'svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import { distribution } from '$lib/platform/build';
	import { installNative, isNative, setSystemBarsDark } from '$lib/platform/native';
	import { settingsStore } from '$lib/stores/settings-store.svelte';
	import AppShell from '$lib/components/layout/AppShell.svelte';

	let { children } = $props();

	settingsStore.hydrate();

	onMount(() => {
		document.documentElement.lang = getLocale();
		installNative();
		// Web: offline cache and the update prompt. The APK carries its own files.
		if (!isNative && !import.meta.env.DEV) {
			void import('$lib/platform/pwa').then((mod) => mod.installServiceWorker());
		}
		// Sideloaded APK: notices of newer GitHub releases. Play updates its own installs.
		if (isNative && distribution === 'github') {
			void import('$lib/platform/release-updates').then((mod) => mod.installReleaseUpdates());
		}
		// Revalidate the eqcaps index in the background (decision 3), so a connect finds it ready.
		void import('$lib/services/eqcaps-client').then((mod) => mod.eqcapsClient().loadIndex());
		// Android: plugging a device in connects it, unplugging it disconnects (Phase 6).
		if (isNative) {
			void import('$lib/services/device-peq-service.svelte').then((mod) =>
				mod.devicePeqService.watchUsb()
			);
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
