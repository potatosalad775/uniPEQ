<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, ChevronRight, ExternalLink } from '@lucide/svelte';
	import ListRow from '$lib/components/atoms/ListRow.svelte';
	import ListSection from '$lib/components/atoms/ListSection.svelte';
	import SelectMenu from '$lib/components/atoms/SelectMenu.svelte';
	import Slider from '$lib/components/atoms/Slider.svelte';
	import Switch from '$lib/components/atoms/Switch.svelte';
	import PageBody from '$lib/components/layout/PageBody.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import LicensesSheet from '$lib/components/settings/LicensesSheet.svelte';
	import LogDialog from '$lib/components/settings/LogDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import { buildLabel } from '$lib/platform/build';
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
	let licensesOpen = $state(false);
	const themeLabel = $derived(themeOptions.find((o) => o.value === settingsStore.theme)?.label);
	const languageLabel = languageOptions.find((o) => o.value === locale)?.label;
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
<!-- Android-style lists (decisions 22, 23): rows with the control trailing, choices in menus. -->
<PageBody class="flex flex-col gap-5 pb-6 wide:max-w-2xl">
	<ListSection title={m.settings_display()}>
		<SelectMenu
			label={m.settings_theme()}
			value={settingsStore.theme}
			options={themeOptions}
			onValueChange={(next) => (settingsStore.theme = next)}
		>
			{#snippet trigger(props)}
				<ListRow label={m.settings_theme()} buttonProps={props}>
					{#snippet trailing()}
						{themeLabel}
						<ChevronDown class="ml-1 size-4" aria-hidden="true" />
					{/snippet}
				</ListRow>
			{/snippet}
		</SelectMenu>
		<SelectMenu
			label={m.settings_language()}
			value={locale}
			options={languageOptions}
			onValueChange={(next) => setLocale(next)}
		>
			{#snippet trigger(props)}
				<ListRow label={m.settings_language()} buttonProps={props}>
					{#snippet trailing()}
						{languageLabel}
						<ChevronDown class="ml-1 size-4" aria-hidden="true" />
					{/snippet}
				</ListRow>
			{/snippet}
		</SelectMenu>
	</ListSection>

	<ListSection title={m.settings_device()}>
		<ListRow
			label={m.device_peq_auto_write()}
			description={m.settings_auto_write_hint()}
			for="auto-write"
		>
			{#snippet trailing()}
				<Switch
					id="auto-write"
					bind:checked={
						() => settingsStore.autoPushEnabled, (on) => devicePeqService.setAutoWrite(on)
					}
				/>
			{/snippet}
		</ListRow>
		<ListRow
			label={m.settings_auto_delay()}
			description={m.settings_auto_delay_hint()}
			disabled={!settingsStore.autoPushEnabled}
		>
			{#snippet trailing()}
				<span class="tabular-nums">{m.settings_seconds({ seconds: delaySeconds })}</span>
			{/snippet}
			<Slider
				min={500}
				max={5000}
				step={250}
				bind:value={settingsStore.autoPushDelayMs}
				disabled={!settingsStore.autoPushEnabled}
				aria-label={m.settings_auto_delay()}
				aria-valuetext={m.settings_seconds({ seconds: delaySeconds })}
			/>
		</ListRow>
	</ListSection>

	<ListSection title={m.settings_diagnostics()}>
		<ListRow label={m.settings_verbose()} description={m.settings_verbose_hint()} for="verbose">
			{#snippet trailing()}
				<Switch id="verbose" bind:checked={settingsStore.verboseLogging} />
			{/snippet}
		</ListRow>
		<ListRow label={m.settings_log_view()} onclick={() => (logOpen = true)}>
			{#snippet trailing()}
				<ChevronRight class="size-4" aria-hidden="true" />
			{/snippet}
		</ListRow>
	</ListSection>

	<ListSection title={m.settings_about_database()}>
		<ListRow
			label="eqcaps"
			description={m.settings_source_hint()}
			href="https://potatosalad775.github.io/eqcaps/"
		>
			{#snippet trailing()}
				<ExternalLink class="size-4" aria-hidden="true" />
			{/snippet}
		</ListRow>
		{#if database}
			<ListRow
				label={m.settings_database_label()}
				description={m.settings_database_count({
					profiles: database.profiles,
					version: database.version
				})}
			/>
		{/if}
	</ListSection>

	<ListSection title={m.settings_about()}>
		<ListRow
			label={m.app_name()}
			description={m.settings_version({
				version: buildLabel ? `${__APP_VERSION__} (${buildLabel})` : __APP_VERSION__
			})}
			href="https://github.com/potatosalad775/uniPEQ"
		>
			{#snippet trailing()}
				<ExternalLink class="size-4" aria-hidden="true" />
			{/snippet}
		</ListRow>
		<ListRow
			label={m.settings_licenses()}
			description={m.settings_licenses_hint()}
			onclick={() => (licensesOpen = true)}
		>
			{#snippet trailing()}
				<ChevronRight class="size-4" aria-hidden="true" />
			{/snippet}
		</ListRow>
	</ListSection>
</PageBody>

<LogDialog bind:open={logOpen} />
<LicensesSheet bind:open={licensesOpen} />
