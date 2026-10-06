<!--
	The band list as numbers, read-only. A stand-in until the Phase 4 graph and band editor.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`);
	const db = (g: number) => `${g > 0 ? '+' : ''}${+g.toFixed(2)} dB`;
</script>

<section aria-labelledby="bands-heading" class="flex flex-col gap-2 rounded-xl bg-base-100 p-4">
	<div class="flex items-baseline justify-between gap-2">
		<h2 id="bands-heading" class="text-sm font-semibold">{m.bands_label()}</h2>
		{#if eqStore.filters.length > 0}
			<span class="text-xs text-base-content/60">{m.bands_preamp({ gain: eqStore.preamp })}</span>
		{/if}
	</div>
	{#if eqStore.filters.length === 0}
		<p class="text-sm text-base-content/70">{m.bands_empty()}</p>
	{:else}
		<table class="w-full text-sm tabular-nums">
			<thead class="text-left text-xs text-base-content/60">
				<tr>
					<th class="py-1 font-medium">{m.bands_index()}</th>
					<th class="py-1 font-medium">{m.device_peq_field_type()}</th>
					<th class="py-1 text-right font-medium">{m.device_peq_field_freq()}</th>
					<th class="py-1 text-right font-medium">{m.device_peq_field_q()}</th>
					<th class="py-1 text-right font-medium">{m.device_peq_field_gain()}</th>
				</tr>
			</thead>
			<tbody>
				{#each eqStore.filters as filter, i (i)}
					<tr
						class="border-t border-base-content/10 {filter.enabled ? '' : 'text-base-content/50'}"
					>
						<td class="py-1">{i + 1}</td>
						<td class="py-1">{filter.type}{filter.enabled ? '' : ` (${m.bands_off()})`}</td>
						<td class="py-1 text-right">{hz(filter.freq)}</td>
						<td class="py-1 text-right">{+filter.q.toFixed(3)}</td>
						<td class="py-1 text-right">{db(filter.gain)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
