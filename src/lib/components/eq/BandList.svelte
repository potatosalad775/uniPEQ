<!--
	The bands as rows: type, frequency, gain, Q, and a flag where the device won't take the
	band as it is. A row selects its band (as tapping its node does). `inlineEditor` (the desktop
	layout) opens the selected band's editor under its row; on a phone the editor is a sheet.
	Layout after modernGraphTool's EqFilterList, rewritten lighter (no channels, no AutoEQ).
	Touch-height rows, no per-band switch, Add band as the last row, and no card of its own: it
	sits in the EQ tab's band card under the preamp. A device with a set band count has no Add row;
	Fit pads a short list. Rows, Add and Fit are off while the device is disconnected.
-->
<script lang="ts">
	import { Plus, TriangleAlert } from '@lucide/svelte';
	import { usesGain } from '@potatosalad775/eqcaps-core';
	import Button from '#lib/components/atoms/Button.svelte';
	import { isPastMaxBands, newBand } from '#lib/eq/eq-constraint.js';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';
	import BandEditor from './BandEditor.svelte';
	import { formatFreq, formatGain, formatQ } from './type-labels';

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

	/**
	 * Why Fit is offered, once a device is known: no bands yet (start from its count, flat), bands
	 * it won't take, or fewer bands than it has.
	 */
	const fitNote = $derived.by(() => {
		const device = devicePeqStore.knownDevice?.name ?? '';
		if (!eqConstraintStore.editable || !eqConstraintStore.fitted) return null;
		if (eqStore.filters.length === 0) return m.eq_empty_fixed({ device, count: maxBands });
		const { misfits, missing } = eqConstraintStore;
		if (misfits > 0) return m.eq_misfits({ count: misfits, device });
		if (missing > 0) return m.eq_short({ count: missing, device });
		return null;
	});

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

	<!-- Nothing refits the list on its own: it only says what doesn't fit, and Fit is the user's call. -->
	{#if fitNote}
		<div class="mx-3.5 mt-1 mb-4 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2">
			<p class="min-w-0 flex-1 text-xs touch:text-sm">{fitNote}</p>
			<Button title={m.eq_fit_title()} size="sm" variant="outline" class="shrink-0" onclick={fit}>
				{eqStore.filters.length === 0 ? m.eq_start_flat() : m.eq_fit()}
			</Button>
		</div>
	{/if}

	{#if eqStore.filters.length === 0}
		{#if !fitNote}
			<p class="px-4 py-3 text-sm text-base-content/70">{m.bands_empty()}</p>
		{/if}
	{:else}
		<ul class="flex flex-col" aria-label={m.bands_label()}>
			{#each eqStore.filters as filter, i (i)}
				{@const isSelected = eqStore.selected === i}
				{@const off = isPastMaxBands(i, profile)}
				<li class="group {isSelected ? 'bg-primary/8' : ''}">
					<button
						type="button"
						aria-expanded={inlineEditor ? isSelected : undefined}
						aria-pressed={inlineEditor ? undefined : isSelected}
						disabled={!eqConstraintStore.editable}
						class="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm tabular-nums group-last:rounded-b-xl hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset active:bg-base-content/10 disabled:pointer-events-none disabled:opacity-60 touch:min-h-14 touch:gap-2 touch:text-base
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
						<!-- Numbers at full size, units small: one line at 360 dp, columns in step. -->
						<span class="min-w-0 flex-1 truncate">
							{formatFreq(filter.freq)} <span class="text-xs text-base-content/60">Hz</span>
						</span>
						<span class="w-[6.5ch] shrink-0 text-right whitespace-nowrap">
							{#if usesGain(filter.type)}
								{formatGain(filter.gain)} <span class="text-xs text-base-content/60">dB</span>
							{:else}
								—
							{/if}
						</span>
						<span class="w-[6ch] shrink-0 text-right whitespace-nowrap text-base-content/70">
							<span class="text-xs text-base-content/60">Q</span>
							{formatQ(filter.q)}
						</span>
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

	{#if eqConstraintStore.canAdd}
		<button
			type="button"
			title={m.eq_add_band_title()}
			class="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium text-primary hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset active:bg-base-content/10 disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-14 touch:text-base"
			onclick={add}
		>
			<Plus class="size-5" aria-hidden="true" />
			{m.eq_add_band_title()}
		</button>
	{/if}
</section>
