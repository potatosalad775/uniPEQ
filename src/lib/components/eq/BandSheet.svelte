<!--
	The phone's band editor: a sheet over the bottom of the screen while a band is selected. Not
	modal, so the graph above stays live and a node can still be dragged while the sheet is up.
	Android back (or the close button) deselects, which closes it.
-->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import * as m from '$lib/paraglide/messages';
	import { onBack } from '$lib/platform/back-button';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import BandEditor from './BandEditor.svelte';

	let { index }: { index: number } = $props();

	const close = () => eqStore.select(null);

	$effect(() =>
		onBack(() => {
			close();
			return true;
		})
	);
</script>

<div
	role="dialog"
	aria-modal="false"
	aria-label={m.eq_band_editor()}
	transition:fly={{ y: 240, duration: 180 }}
	class="fixed inset-x-0 bottom-0 z-30 max-h-[55dvh] overflow-y-auto rounded-t-2xl border-t border-base-content/10 bg-base-100 px-4 pt-3 pr-[calc(1rem+var(--inset-right))] pb-[calc(1rem+var(--inset-bottom))] pl-[calc(1rem+var(--inset-left))] shadow-[0_-8px_24px_rgb(0_0_0/0.15)]"
>
	<div class="mx-auto mb-2 h-1 w-10 rounded-full bg-base-content/20" aria-hidden="true"></div>
	<BandEditor {index} onClose={close} />
</div>
