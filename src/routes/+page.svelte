<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import DevicePanel from '$lib/components/device/DevicePanel.svelte';
	import BandList from '$lib/components/eq/BandList.svelte';
	import BandSheet from '$lib/components/eq/BandSheet.svelte';
	import EqGraph from '$lib/components/eq/EqGraph.svelte';
	import EqToolbar from '$lib/components/eq/EqToolbar.svelte';
	import PreampControl from '$lib/components/eq/PreampControl.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	/** The `wide:` breakpoint (layout.css): the band editor opens in the list, not in a sheet. */
	const wide = new MediaQuery('min-width: 56.25rem');
	const sheetOpen = $derived(!wide.current && eqStore.selected !== null);

	let graph: HTMLElement | undefined = $state();
	// The sheet covers the lower half of a phone: bring the graph to the top as it opens, so the band
	// being edited stays in sight (and draggable) above it.
	$effect(() => {
		if (sheetOpen) graph?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	});
</script>

<PageHeader title={m.nav_main()} />
<!--
	Phone: device, graph, preamp, bands, stacked; the selected band's editor is a sheet.
	Wide: the graph (held in view while the page scrolls) beside the device and the band list, whose
	selected row opens the editor in place.
-->
<div
	class="flex flex-col gap-4 px-4 pb-4 wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] wide:items-start"
>
	<div class="wide:col-start-2 wide:row-start-1">
		<DevicePanel />
	</div>
	<div
		class="flex flex-col gap-3 wide:sticky wide:top-0 wide:col-start-1 wide:row-span-2 wide:row-start-1"
	>
		<EqToolbar />
		<div bind:this={graph} class="h-[40dvh] min-h-56 scroll-mt-2 wide:h-[min(32rem,60dvh)]">
			<EqGraph />
		</div>
		<PreampControl />
	</div>
	<div class="wide:col-start-2 wide:row-start-2">
		<BandList inlineEditor={wide.current} />
	</div>
</div>

{#if sheetOpen && eqStore.selected !== null}
	<BandSheet index={eqStore.selected} />
	<!-- Room to scroll the graph, and the last rows, above the sheet -->
	<div class="h-[55dvh]" aria-hidden="true"></div>
{/if}
