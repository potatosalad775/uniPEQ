<!--
	The preamp, by the profile's `preamp.mode` (eqcaps SPEC §9, `preampControl`), as one row of the
	EQ tab's band card (decision 22):
	- manual: Auto (follow the bands: −largest boost), and a slider over the device's range while
	  Auto is off;
	- unknown: the same slider over a guessed range, with a note;
	- auto: nothing (the device sets its own headroom);
	- none, or a protocol that can't send one: no slider, and a warning while the EQ boosts.
-->
<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { project } from '@potatosalad775/eqcaps-core';
	import Slider from '$lib/components/atoms/Slider.svelte';
	import Switch from '$lib/components/atoms/Switch.svelte';
	import { derivePreamp } from '$lib/eq/eq-preamp';
	import * as m from '$lib/paraglide/messages';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	const control = $derived(eqConstraintStore.preamp);
	/** What the bands need to stay clear of clipping (≤ 0). */
	const needed = $derived(derivePreamp(eqStore.filters));
	const boosts = $derived(needed < 0);
	/** The preamp set leaves less headroom than the bands boost by. */
	const clips = $derived(control.kind === 'slider' && eqStore.preamp > needed + 0.05);
	const shown = $derived(Math.round(eqStore.preamp * 10) / 10 || 0);

	function set(value: number) {
		if (control.kind !== 'slider') return;
		eqStore.setPreamp(project(Math.round(value * 10) / 10, control.domain, 'preamp'), 'preamp');
	}
</script>

{#if control.kind === 'slider'}
	<section aria-labelledby="preamp-heading" class="flex flex-col px-4 py-2">
		<div class="flex min-h-10 items-center gap-3">
			<h2 id="preamp-heading" class="flex flex-1 items-baseline gap-2 text-sm touch:text-base">
				{m.eq_preamp()}
				<span class="font-medium tabular-nums">{shown} dB</span>
			</h2>
			<Switch
				size="sm"
				labelSide="start"
				checked={eqStore.autoPreamp}
				onCheckedChange={(on) => eqStore.setAutoPreamp(on)}
				labelText={m.eq_preamp_auto()}
				labelClass="text-sm font-normal text-base-content/70"
			/>
		</div>
		{#if !eqStore.autoPreamp}
			<Slider
				min={control.min}
				max={control.max}
				step={control.step}
				value={eqStore.preamp}
				aria-label={m.eq_preamp()}
				aria-valuetext="{shown} dB"
				oninput={(e) => set(Number(e.currentTarget.value))}
			/>
		{/if}
		{#if control.unknown}
			<p class="text-xs text-base-content/60">{m.eq_preamp_unknown()}</p>
		{/if}
		{#if clips}
			<p class="flex items-center gap-1.5 pb-1 text-xs text-warning">
				<TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
				{m.eq_preamp_clips({ needed })}
			</p>
		{/if}
	</section>
{:else if control.kind === 'none' && boosts}
	<p class="flex items-start gap-2 bg-warning/10 px-4 py-2 text-xs" role="status">
		<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
		{m.eq_preamp_none_boost({ boost: -needed })}
	</p>
{/if}
