<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import SegmentedControl from '$lib/components/atoms/SegmentedControl.svelte';
	import Switch from '$lib/components/atoms/Switch.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import LogDialog from '$lib/components/settings/LogDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
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

	let logOpen = $state(false);
	/** The device database the app holds: its data version and how many profiles. */
	let database = $state<{ version: string; profiles: number } | null>(null);

	onMount(() => {
		let gone = false;
		void import('$lib/services/eqcaps-client')
			.then((mod) => mod.eqcapsClient().loadIndex())
			.then((index) => {
				if (!gone && index) {
					database = { version: index.dataVersion, profiles: index.profiles.length };
				}
			});
		return () => (gone = true);
	});

	const delaySeconds = $derived((settingsStore.autoPushDelayMs / 1000).toFixed(2));
</script>

<PageHeader title={m.nav_settings()} />
<div class="flex flex-col gap-4 px-4 pb-4 wide:max-w-2xl">
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

	<section class="flex flex-col gap-3 rounded-xl bg-base-100 p-4">
		<h2 class="text-sm font-semibold">{m.settings_device()}</h2>
		<Switch
			size="sm"
			bind:checked={() => settingsStore.autoPushEnabled, (on) => devicePeqService.setAutoWrite(on)}
			labelText={m.device_peq_auto_write()}
			labelClass="text-sm font-normal"
		/>
		<div class="flex flex-col gap-1 {settingsStore.autoPushEnabled ? '' : 'opacity-50'}">
			<div class="flex items-center justify-between gap-4">
				<label for="auto-delay" class="text-sm">{m.settings_auto_delay()}</label>
				<span class="text-sm text-base-content/70 tabular-nums">
					{m.settings_seconds({ seconds: delaySeconds })}
				</span>
			</div>
			<input
				id="auto-delay"
				type="range"
				min="500"
				max="5000"
				step="250"
				bind:value={settingsStore.autoPushDelayMs}
				disabled={!settingsStore.autoPushEnabled}
				aria-valuetext={m.settings_seconds({ seconds: delaySeconds })}
				class="h-6 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
			/>
			<p class="text-xs text-base-content/60">{m.settings_auto_delay_hint()}</p>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-xl bg-base-100 p-4">
		<h2 class="text-sm font-semibold">{m.settings_diagnostics()}</h2>
		<Switch
			size="sm"
			bind:checked={settingsStore.verboseLogging}
			labelText={m.settings_verbose()}
			labelClass="text-sm font-normal"
		/>
		<p class="text-xs text-base-content/60">{m.settings_verbose_hint()}</p>
		<div>
			<Button
				title={m.settings_log_view()}
				variant="outline"
				size="sm"
				onclick={() => (logOpen = true)}
			>
				{m.settings_log_view()}
			</Button>
		</div>
	</section>

	<section class="flex flex-col gap-1 rounded-xl bg-base-100 p-4">
		<h2 class="text-sm font-semibold">{m.settings_about()}</h2>
		<p class="text-sm text-base-content/70">
			{m.app_name()} · {m.settings_version({ version: __APP_VERSION__ })}
		</p>
		{#if database}
			<p class="text-sm text-base-content/70">
				{m.settings_database({ profiles: database.profiles, version: database.version })}
			</p>
		{/if}
		<p class="text-sm text-base-content/70">
			{m.settings_database_source()}
			<a
				href="https://potatosalad775.github.io/eqcaps/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary underline-offset-4 hover:underline">eqcaps</a
			>
		</p>
	</section>
</div>

<LogDialog bind:open={logOpen} />
