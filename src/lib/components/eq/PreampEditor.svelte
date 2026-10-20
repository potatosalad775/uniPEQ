<!--
	The preamp's editor, opened from its row: in a sheet on a phone, under the row on
	`wide:`. Auto (follow the bands: −largest boost) as a switch row; while it's off, the level as a
	band field (− value + over a slider) bounded by the device's range. The guessed-range note and
	the clipping warning sit under it. Only for a `slider` preamp control.
-->
<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { project } from '@potatosalad775/eqcaps-core';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import Switch from '#lib/components/atoms/Switch.svelte';
	import { derivePreamp } from '#lib/eq/eq-preamp.js';
	import * as m from '#lib/paraglide/messages.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';
	import BandField from './BandField.svelte';

	const control = $derived(eqConstraintStore.preamp);
	const needed = $derived(derivePreamp(eqStore.filters));
	const clips = $derived(control.kind === 'slider' && eqStore.preamp > needed + 0.05);
	const shown = $derived(Math.round(eqConstraintStore.preampValue * 10) / 10 || 0);
	const id = $props.id();

	function set(value: number, history: boolean | string) {
		if (control.kind !== 'slider') return;
		const db = project(Math.round(value * 10) / 10, control.domain, 'preamp');
		// Its own coalesce keys, so a held preamp key never joins a band's gain step.
		eqStore.setPreamp(db, typeof history === 'string' ? `preamp-${history}` : history);
	}
</script>

{#if control.kind === 'slider'}
	<fieldset disabled={!eqConstraintStore.editable} class="flex min-w-0 flex-col gap-2">
		<ListRow
			label={m.eq_preamp_auto()}
			description={m.eq_preamp_auto_hint()}
			for="{id}-auto"
			class="-mx-4"
		>
			{#snippet trailing()}
				<Switch
					id="{id}-auto"
					checked={eqStore.autoPreamp}
					onCheckedChange={(on) => eqStore.setAutoPreamp(on)}
				/>
			{/snippet}
		</ListRow>
		{#if eqStore.autoPreamp}
			<p class="flex items-baseline justify-between text-sm text-base-content/70">
				{m.eq_preamp()}
				<span class="font-medium text-base-content tabular-nums">{shown} dB</span>
			</p>
		{:else}
			<BandField
				field="gain"
				label={m.eq_preamp()}
				unit="dB"
				value={shown}
				domain={control.domain}
				onChange={set}
			/>
		{/if}
		{#if control.unknown}
			<p class="text-xs text-base-content/60">{m.eq_preamp_unknown()}</p>
		{/if}
		{#if clips}
			<p class="flex items-start gap-1.5 text-xs text-warning" role="status">
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
				{m.eq_preamp_clips({ needed })}
			</p>
		{/if}
	</fieldset>
{/if}
