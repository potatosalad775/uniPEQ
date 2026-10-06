<script lang="ts">
	import SegmentedControl from '$lib/components/atoms/SegmentedControl.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import { settingsStore, type ThemeSetting } from '$lib/stores/settings-store.svelte';

	const themeOptions: { value: ThemeSetting; label: string }[] = [
		{ value: 'system', label: m.settings_theme_system() },
		{ value: 'light', label: m.settings_theme_light() },
		{ value: 'dark', label: m.settings_theme_dark() }
	];

	// Endonyms: each language is listed in its own script, whatever the UI language.
	const languageOptions: { value: Locale; label: string }[] = [
		{ value: 'en', label: 'English' },
		{ value: 'ko', label: '한국어' }
	];

	// setLocale reloads the page, so this never needs to be reactive.
	const locale = getLocale();
</script>

<PageHeader title={m.nav_settings()} />
<div class="flex flex-col gap-4 px-4 pb-4">
	<section class="flex flex-col gap-3 rounded-xl bg-base-100 p-4">
		<h2 class="text-sm font-semibold">{m.settings_appearance()}</h2>
		<div class="flex items-center justify-between gap-4">
			<span class="text-sm">{m.settings_theme()}</span>
			<SegmentedControl
				bind:value={settingsStore.theme}
				options={themeOptions}
				label={m.settings_theme()}
				class="w-56"
			/>
		</div>
		<div class="flex items-center justify-between gap-4">
			<span class="text-sm">{m.settings_language()}</span>
			<SegmentedControl
				value={locale}
				options={languageOptions}
				label={m.settings_language()}
				onValueChange={(next) => setLocale(next)}
				class="w-56"
			/>
		</div>
	</section>

	<section class="flex flex-col gap-1 rounded-xl bg-base-100 p-4">
		<h2 class="text-sm font-semibold">{m.settings_about()}</h2>
		<p class="text-sm text-base-content/70">
			{m.app_name()} · {m.settings_version({ version: __APP_VERSION__ })}
		</p>
	</section>
</div>
