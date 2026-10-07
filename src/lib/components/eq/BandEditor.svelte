<!--
	The selected band, every field. Adapted from modernGraphTool
	src/lib/components/equalizer/EqFilterCard.svelte @ 23ddc4dd: no channel scope, every eqcaps type
	the slot takes, and the fields in BandField. Domains come from the band's slot (`resolveSlot`):
	bounds, steps, value lists, locked fields read-only; flags from `validateList`. Edits are
	projected onto the slot as they are made; other fields are left alone (Fit folds those in).
	Phase 4.5 (decision 22): types as chips, no on/off, and the header only inline (the phone's
	sheet has its own, with previous / next).
-->
<script lang="ts">
	import { Trash2 } from '@lucide/svelte';
	import { usesGain } from '@potatosalad775/eqcaps-core';
	import Button from '$lib/components/atoms/Button.svelte';
	import ChipGroup from '$lib/components/atoms/ChipGroup.svelte';
	import { appTypesOf, editFilter, isPastMaxBands, slotOf } from '$lib/eq/eq-constraint';
	import type { EqFilter, FilterType } from '$lib/eq/model';
	import * as m from '$lib/paraglide/messages';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import BandField from './BandField.svelte';
	import { TYPE_LABEL } from './type-labels';

	let {
		index,
		header = true
	}: {
		index: number;
		/** The band's heading; the phone's sheet shows its own instead. */
		header?: boolean;
	} = $props();

	const filter = $derived(eqStore.filters[index]);
	const profile = $derived(eqConstraintStore.profile);
	const slotIndex = $derived(eqConstraintStore.slots[index] ?? index);
	const slot = $derived(filter ? slotOf(profile, slotIndex, filter) : null);
	const violation = $derived(eqConstraintStore.violations[index]);
	const pastCap = $derived(isPastMaxBands(index, profile));
	/** The slot's types, plus the band's own when it isn't one, so the flag has something to show. */
	const types = $derived.by(() => {
		if (!slot || !filter) return [];
		const allowed = appTypesOf(slot.types);
		return allowed.includes(filter.type) ? allowed : [...allowed, filter.type];
	});
	const typeOptions = $derived(types.map((t) => ({ value: t, label: t, title: TYPE_LABEL[t]() })));

	function set(patch: Partial<EqFilter>, history: boolean | string = true) {
		if (!filter) return;
		eqStore.update(index, editFilter(filter, patch, profile, slotIndex), history);
	}

	/** BandField's keys are per field; make them per band too. */
	const keyed = (history: boolean | string) =>
		typeof history === 'string' ? `${history}-${index}` : history;
</script>

{#if filter && slot}
	<div class="flex flex-col gap-3" aria-label={m.eq_band_number({ band: index + 1 })} role="group">
		{#if header}
			<h3 class="truncate text-sm font-semibold">
				{m.eq_band_number({ band: index + 1 })} · {TYPE_LABEL[filter.type]()}
				{#if slot.label}
					<span class="font-normal text-base-content/60">· {slot.label}</span>
				{/if}
			</h3>
		{/if}

		{#if pastCap}
			<p class="text-xs text-warning">
				{m.eq_band_past_cap({ max: eqConstraintStore.maxBands })}
			</p>
		{/if}

		<div class="flex flex-col gap-1.5">
			{#if types.length > 1}
				<ChipGroup
					value={filter.type}
					options={typeOptions}
					label={m.device_peq_field_type()}
					invalid={violation?.type}
					onValueChange={(type: FilterType) => set({ type })}
				/>
			{:else}
				<span class="text-sm" title={m.eq_field_locked()}>
					{filter.type} · {TYPE_LABEL[filter.type]()}
				</span>
			{/if}
			{#if violation?.type}
				<p class="text-xs text-error">{m.eq_type_violation()}</p>
			{/if}
		</div>

		<BandField
			field="freq"
			label={m.device_peq_field_freq()}
			unit="Hz"
			value={filter.freq}
			domain={slot.freq}
			locked={slot.locked.freq}
			violation={violation?.freq}
			onChange={(freq, history) => set({ freq }, keyed(history))}
		/>
		{#if usesGain(filter.type)}
			<BandField
				field="gain"
				label={m.device_peq_field_gain()}
				unit="dB"
				value={filter.gain}
				domain={slot.gain}
				locked={slot.locked.gain}
				violation={violation?.gain}
				onChange={(gain, history) => set({ gain }, keyed(history))}
			/>
		{:else}
			<p class="text-xs text-base-content/60">{m.eq_type_no_gain()}</p>
		{/if}
		<BandField
			field="q"
			label={m.device_peq_field_q()}
			unit=""
			value={filter.q}
			domain={slot.q}
			locked={slot.locked.q}
			violation={violation?.q}
			onChange={(q, history) => set({ q }, keyed(history))}
		/>

		{#if !eqConstraintStore.isGraphic}
			<div class="flex justify-end">
				<Button
					title={m.eq_band_remove({ band: index + 1 })}
					size="sm"
					variant="ghost"
					class="gap-1.5 text-error"
					onclick={() => eqStore.remove(index)}
				>
					<Trash2 class="size-4" aria-hidden="true" />
					{m.eq_band_remove_short()}
				</Button>
			</div>
		{/if}
	</div>
{/if}
