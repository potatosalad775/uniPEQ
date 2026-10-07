<!--
	The bands as rows: type, frequency, gain, Q, and a flag where the device won't take the
	band as it is. A row selects its band (as tapping its node does). `inlineEditor` (the desktop
	layout) opens the selected band's editor under its row; on a phone the editor is a sheet.
	Layout after modernGraphTool's EqFilterList, rewritten lighter (no channels, no AutoEQ).
	Phase 4.5 (decision 22): touch-height rows, no per-band switch, Add band as the last row, and
	no card of its own: it sits in the EQ tab's band card under the preamp.
-->
<script lang="ts">
	import { Plus, TriangleAlert } from '@lucide/svelte';
	import { usesGain } from '@potatosalad775/eqcaps-core';
	import Button from '$lib/components/atoms/Button.svelte';
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

<section aria-labelledby="bands-heading" class="flex flex-col">
	<div class="flex min-h-10 items-center gap-2 px-4 pt-2">
		<h2 id="bands-heading" class="text-xs font-semibold tracking-wide text-primary uppercase">
			{m.bands_label()}
			<span class="ml-1 font-normal text-base-content/60 normal-case">
				{maxBands > 0
					? m.bands_count_of({ count: eqStore.filters.length, max: maxBands })
					: eqStore.filters.length}
			</span>
		</h2>
	</div>

	<!-- Connecting never edits the list: it only says what doesn't fit, and Fit is the user's call. -->
	{#if devicePeqStore.isConnected && eqConstraintStore.misfits > 0 && eqConstraintStore.fitted}
		<div class="mx-4 my-1 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2">
			<p class="min-w-0 flex-1 text-xs touch:text-sm">
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
		<p class="px-4 py-3 text-sm text-base-content/70">{m.bands_empty()}</p>
	{:else}
		<ul class="flex flex-col" aria-label={m.bands_label()}>
			{#each eqStore.filters as filter, i (i)}
				{@const isSelected = eqStore.selected === i}
				{@const off = isPastMaxBands(i, profile)}
				<li class={isSelected ? 'bg-primary/8' : ''}>
					<button
						type="button"
						aria-expanded={inlineEditor ? isSelected : undefined}
						aria-pressed={inlineEditor ? undefined : isSelected}
						class="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm tabular-nums hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset active:bg-base-content/10 touch:min-h-14 touch:text-base
							{off ? 'text-base-content/50' : ''}"
						onclick={() => eqStore.select(isSelected && inlineEditor ? null : i)}
					>
						<span
							class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
								{isSelected ? 'bg-primary text-primary-content' : 'bg-base-content/10 text-base-content/70'}"
						>
							{i + 1}
						</span>
						<span
							class="w-9 shrink-0 rounded bg-base-300 px-1 text-center text-[11px] font-medium touch:text-xs"
						>
							{filter.type}
						</span>
						<span class="min-w-0 flex-1 truncate">{formatHz(filter.freq)}</span>
						<span class="w-16 shrink-0 text-right">
							{usesGain(filter.type) ? formatDb(filter.gain) : '—'}
						</span>
						<span class="w-14 shrink-0 text-right text-base-content/60">Q {formatQ(filter.q)}</span>
						{#if flagged(i)}
							<TriangleAlert
								class="size-4 shrink-0 text-warning"
								aria-label={m.eq_band_misfit()}
								role="img"
							/>
						{/if}
					</button>
					{#if inlineEditor && isSelected}
						<div class="border-t border-base-content/10 px-4 pt-2 pb-3">
							<BandEditor index={i} />
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if !eqConstraintStore.isGraphic}
		<button
			type="button"
			title={m.eq_add_band_title()}
			disabled={!eqConstraintStore.canAdd}
			class="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium text-primary hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset active:bg-base-content/10 disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-14 touch:text-base"
			onclick={add}
		>
			<Plus class="size-5" aria-hidden="true" />
			{m.eq_add_band_title()}
		</button>
	{/if}
</section>
