<!--
	The preamp, by the profile's `preamp.mode` (eqcaps SPEC §9, `preampControl`), as the first row
	of the EQ tab's band card: one row in the band rows' shape (an icon where a band
	has its number, the level in the gain column, "Auto" in the Q column, and the warning flag when
	it may clip); tapping it opens `PreampEditor`, in a sheet on a phone and under the row with
	`inlineEditor` (wide).
	- manual, or unknown (a guessed range): that row;
	- auto: nothing (the device sets its own headroom);
	- none, or a protocol that can't send one: no row, and a warning while the EQ boosts.
-->
<script lang="ts">
	import { ChevronDown, TriangleAlert, Volume2 } from '@lucide/svelte';
	import Badge from '#lib/components/atoms/Badge.svelte';
	import Sheet from '#lib/components/atoms/Sheet.svelte';
	import { derivePreamp } from '#lib/eq/eq-preamp.js';
	import * as m from '#lib/paraglide/messages.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';
	import PreampEditor from './PreampEditor.svelte';
	import { formatGain } from './type-labels';

	let { inlineEditor = false }: { inlineEditor?: boolean } = $props();

	const control = $derived(eqConstraintStore.preamp);
	/** What the bands need to stay clear of clipping (≤ 0). */
	const needed = $derived(derivePreamp(eqStore.filters));
	const boosts = $derived(needed < 0);
	/** The preamp set leaves less headroom than the bands boost by. */
	const clips = $derived(control.kind === 'slider' && eqStore.preamp > needed + 0.05);

	let open = $state(false);
	// Read-only while the device is away: its editor closes.
	$effect(() => {
		if (!eqConstraintStore.editable) open = false;
	});

	function toggle() {
		// One editor at a time: the band sheet would sit over this one.
		if (!inlineEditor) eqStore.select(null);
		open = inlineEditor ? !open : true;
	}
</script>

{#if control.kind === 'slider'}
	<div class={open && inlineEditor ? 'rounded-t-xl bg-primary/8' : ''}>
		<button
			type="button"
			aria-expanded={inlineEditor ? open : undefined}
			aria-haspopup={inlineEditor ? undefined : 'dialog'}
			disabled={!eqConstraintStore.editable}
			class="flex min-h-12 w-full items-center gap-3 rounded-t-xl px-4 text-left text-sm tabular-nums hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset active:bg-base-content/10 disabled:pointer-events-none disabled:opacity-60 touch:min-h-14 touch:gap-2 touch:text-base"
			onclick={toggle}
		>
			<span
				class="flex size-6 shrink-0 items-center justify-center rounded-full bg-base-content/10 text-base-content/70"
				aria-hidden="true"
			>
				<Volume2 class="size-3.5" />
			</span>
			<span class="min-w-0 flex-1 truncate">{m.eq_preamp()}</span>
			{#if eqStore.autoPreamp}
				<Badge tone="primary">{m.eq_preamp_auto()}</Badge>
			{/if}
			<!-- The band rows' gain and Q columns. -->
			<span class="w-[6.5ch] shrink-0 text-right whitespace-nowrap">
				{formatGain(eqConstraintStore.preampValue)}
				<span class="text-xs text-base-content/60">dB</span>
			</span>
			<span class="flex w-[6ch] shrink-0 justify-end">
				{#if clips}
					<TriangleAlert
						class="size-4 shrink-0 text-warning"
						aria-label={m.eq_preamp_clips({ needed })}
						role="img"
					/>
				{/if}
				{#if inlineEditor}
					<ChevronDown
						class="size-4 shrink-0 text-base-content/60 {open ? 'rotate-180' : ''}"
						aria-hidden="true"
					/>
				{/if}
			</span>
		</button>
		{#if inlineEditor && open}
			<div class="border-t border-base-content/10 px-4 pt-1 pb-3">
				<PreampEditor />
			</div>
		{/if}
	</div>
	{#if !inlineEditor}
		<Sheet bind:open title={m.eq_preamp()}>
			<PreampEditor />
		</Sheet>
	{/if}
{:else if control.kind === 'none' && boosts}
	<p class="flex items-start gap-2 bg-warning/10 px-4 py-2 text-xs" role="status">
		<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
		{m.eq_preamp_none_boost({ boost: -needed })}
	</p>
{/if}
