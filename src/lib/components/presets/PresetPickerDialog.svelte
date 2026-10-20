<!--
	Load a saved preset into the EQ from the EQ screen: search, the fit to the connected device, and
	one press to load (one undoable step). Nothing is written here: with auto-write on, the device
	follows through the usual review when it can't hold the preset as it is.
-->
<script lang="ts">
	import { Search } from '@lucide/svelte';
	import Badge from '$lib/components/atoms/Badge.svelte';
	import Input from '$lib/components/atoms/Input.svelte';
	import ModalDialog from '$lib/components/atoms/ModalDialog.svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import type { PresetFit } from '$lib/device-peq/preset-fit';
	import * as m from '$lib/paraglide/messages';
	import { logger } from '$lib/services/logger';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { noticeStore } from '$lib/stores/notice-store.svelte';
	import { searchPresets } from '$lib/services/preset-storage';
	import { presetStore } from '$lib/stores/preset-store.svelte';
	import { describePresetError, fitBadge, withWarnings } from './preset-messages';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let query = $state('');
	let fits = $state.raw<Record<string, PresetFit>>({});
	const shown = $derived(searchPresets(presetStore.index, query));

	$effect(() => {
		if (!open) return;
		query = '';
		void presetStore.refresh();
	});

	$effect(() => {
		const profile = devicePeqStore.profile;
		const caps = devicePeqStore.capabilities;
		void presetStore.index;
		if (!open || !profile || !caps) {
			fits = {};
			return;
		}
		let stale = false;
		void presetStore.fits(profile, caps).then((next) => {
			if (!stale) fits = next;
		});
		return () => (stale = true);
	});

	async function load(id: string) {
		open = false;
		try {
			const parsed = await presetStore.apply(id);
			noticeStore.say(withWarnings(m.presets_loaded({ name: parsed.preset.name }), parsed));
		} catch (e) {
			logger.error('preset load failed:', e instanceof Error ? e.message : String(e));
			noticeStore.say(describePresetError(e), true);
		}
	}
</script>

<ModalDialog bind:open title={m.eq_load_preset()}>
	{#if presetStore.index.length === 0}
		<p class="text-sm text-base-content/70">{m.presets_empty()}</p>
	{:else}
		{#if presetStore.index.length > 5}
			<Input bind:value={query} placeholder={m.presets_search_placeholder()} type="search">
				{#snippet icon()}<Search class="size-4 text-base-content/50" />{/snippet}
			</Input>
		{/if}
		<ul
			class="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
			aria-label={m.presets_list_label()}
		>
			{#each shown as entry (entry.id)}
				{@const fit = fits[entry.id]}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
						onclick={() => load(entry.id)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{entry.name}</span>
							{#if entry.tags.length}
								<span class="block truncate text-xs text-base-content/60">
									{entry.tags.join(', ')}
								</span>
							{/if}
						</span>
						{#if fit}
							{@const badge = fitBadge(fit)}
							<Badge tone={badge.tone}>{badge.text}</Badge>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-2 py-2 text-sm text-base-content/70">{m.presets_no_match()}</li>
			{/each}
		</ul>
	{/if}
	{#snippet footer()}
		<Button title={m.dialog_close()} variant="ghost" size="md" onclick={() => (open = false)}>
			{m.dialog_close()}
		</Button>
	{/snippet}
</ModalDialog>
