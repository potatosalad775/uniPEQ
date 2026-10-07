<!--
	The bands as rows: on/off, type, frequency, gain, Q, and a flag where the device won't take the
	band as it is. A row selects its band (as tapping its node does). `inlineEditor` (the desktop
	layout) opens the selected band's editor under its row; on a phone the editor is a sheet.
	Layout after modernGraphTool's EqFilterList, rewritten lighter (no channels, no AutoEQ).
-->
<script lang="ts">
	import { Plus, TriangleAlert } from '@lucide/svelte';
	import { usesGain } from '@potatosalad775/eqcaps-core';
	import Button from '$lib/components/atoms/Button.svelte';
	import Switch from '$lib/components/atoms/Switch.svelte';
	import { isPastMaxBands, newBand } from '$lib/eq/eq-constraint';
	import * as m from '$lib/paraglide/messages';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import BandEditor from './BandEditor.svelte';
	import { formatDb, formatHz, formatQ } from './type-labels';

	let { inlineEditor = false }: { inlineEditor?: boolean } = $props();

	const profile = $derived(eqConstraintStore.profile);
	const maxBands = $derived(eqConstraintStore.maxBands);

	function add() {
		eqStore.add(newBand(eqStore.filters, profile));
	}

	function fit() {
		const next = eqConstraintStore.fitted;
		if (next) eqStore.replace(next);
	}

	function flagged(i: number): boolean {
		const v = eqConstraintStore.violations[i];
		return (!!v && (v.type || v.freq || v.q || v.gain)) || isPastMaxBands(i, profile);
	}
</script>

<section aria-labelledby="bands-heading" class="flex flex-col gap-2 rounded-xl bg-base-100 p-4">
	<div class="flex items-center justify-between gap-2">
		<h2 id="bands-heading" class="text-sm font-semibold">
			{m.bands_label()}
			<span class="font-normal text-base-content/60">
				{maxBands > 0
					? m.bands_count_of({ count: eqStore.filters.length, max: maxBands })
					: eqStore.filters.length}
			</span>
		</h2>
		{#if !eqConstraintStore.isGraphic}
			<Button
				title={m.eq_add_band_title()}
				size="sm"
				variant="outline"
				class="gap-1"
				disabled={!eqConstraintStore.canAdd}
				onclick={add}
			>
				<Plus class="size-4" aria-hidden="true" />
				{m.eq_add_band()}
			</Button>
		{/if}
	</div>

	<!-- Connecting never edits the list: it only says what doesn't fit, and Fit is the user's call. -->
	{#if devicePeqStore.isConnected && eqConstraintStore.misfits > 0 && eqConstraintStore.fitted}
		<div class="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2">
			<p class="min-w-0 flex-1 text-xs">
				{m.eq_misfits({
					count: eqConstraintStore.misfits,
					device: devicePeqStore.deviceName ?? ''
				})}
			</p>
			<Button title={m.eq_fit_title()} size="sm" variant="outline" class="shrink-0" onclick={fit}>
				{m.eq_fit()}
			</Button>
		</div>
	{/if}

	{#if eqStore.filters.length === 0}
		<p class="text-sm text-base-content/70">{m.bands_empty()}</p>
	{:else}
		<ul class="flex flex-col gap-1" aria-label={m.bands_label()}>
			{#each eqStore.filters as filter, i (i)}
				{@const isSelected = eqStore.selected === i}
				{@const off = !filter.enabled || isPastMaxBands(i, profile)}
				<li
					class="rounded-lg border {isSelected
						? 'border-primary/50 bg-primary/5'
						: 'border-base-content/10'}"
				>
					<div class="flex items-center gap-2 py-1 pr-2 pl-2">
						<Switch
							size="sm"
							variant="muted"
							checked={filter.enabled}
							onCheckedChange={(on) => eqStore.update(i, { enabled: on })}
							aria-label={m.eq_band_toggle({ band: i + 1 })}
						/>
						<button
							type="button"
							aria-expanded={inlineEditor ? isSelected : undefined}
							aria-pressed={inlineEditor ? undefined : isSelected}
							class="flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none
								{off ? 'text-base-content/50' : ''}"
							onclick={() => eqStore.select(isSelected && inlineEditor ? null : i)}
						>
							<span class="w-5 shrink-0 text-xs text-base-content/60">{i + 1}</span>
							<span
								class="w-9 shrink-0 rounded bg-base-300 px-1 text-center text-[11px] font-medium"
							>
								{filter.type}
							</span>
							<span class="flex-1 truncate">{formatHz(filter.freq)}</span>
							<span class="w-16 shrink-0 text-right">
								{usesGain(filter.type) ? formatDb(filter.gain) : '—'}
							</span>
							<span class="w-14 shrink-0 text-right text-base-content/70"
								>Q {formatQ(filter.q)}</span
							>
							{#if flagged(i)}
								<TriangleAlert
									class="size-4 shrink-0 text-warning"
									aria-label={m.eq_band_misfit()}
									role="img"
								/>
							{/if}
						</button>
					</div>
					{#if inlineEditor && isSelected}
						<div class="border-t border-base-content/10 px-3 pt-2 pb-3">
							<BandEditor index={i} />
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
