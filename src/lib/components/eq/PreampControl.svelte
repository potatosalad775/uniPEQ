<!--
	The preamp, by the profile's `preamp.mode` (eqcaps SPEC §9, `preampControl`):
	- manual: a slider over the device's range, and Auto (follow the bands: −largest boost);
	- unknown: the same slider over a guessed range, with a note;
	- auto: nothing (the device sets its own headroom);
	- none, or a protocol that can't send one: no slider, and a warning while the EQ boosts.
-->
<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { project } from '@potatosalad775/eqcaps-core';
	import InfoPopover from '$lib/components/atoms/InfoPopover.svelte';
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
	<section aria-labelledby="preamp-heading" class="flex flex-col gap-2 rounded-xl bg-base-100 p-4">
		<div class="flex items-center gap-2">
			<h2 id="preamp-heading" class="flex-1 text-sm font-semibold">
				{m.eq_preamp()}
				<span class="ml-1 font-normal text-base-content/70 tabular-nums">
					{shown} dB
				</span>
			</h2>
			<Switch
				size="sm"
				checked={eqStore.autoPreamp}
				onCheckedChange={(on) => eqStore.setAutoPreamp(on)}
				labelText={m.eq_preamp_auto()}
				labelClass="text-xs text-base-content/70"
			/>
			<InfoPopover label={m.info_popover_about({ topic: m.eq_preamp() })} align="end">
				<p>{m.eq_preamp_hint()}</p>
				{#if control.unknown}<p>{m.eq_preamp_unknown()}</p>{/if}
			</InfoPopover>
		</div>
		<input
			type="range"
			min={control.min}
			max={control.max}
			step={control.step}
			value={eqStore.preamp}
			disabled={eqStore.autoPreamp}
			aria-label={m.eq_preamp()}
			aria-valuetext="{shown} dB"
			oninput={(e) => set(Number(e.currentTarget.value))}
			class="h-6 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
		/>
		{#if control.unknown}
			<p class="text-xs text-base-content/60">{m.eq_preamp_unknown()}</p>
		{/if}
		{#if clips}
			<p class="flex items-center gap-1.5 text-xs text-warning">
				<TriangleAlert class="size-3.5 shrink-0" aria-hidden="true" />
				{m.eq_preamp_clips({ needed })}
			</p>
		{/if}
	</section>
{:else if control.kind === 'none' && boosts}
	<p
		class="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
		role="status"
	>
		<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
		{m.eq_preamp_none_boost({ boost: -needed })}
	</p>
{/if}
