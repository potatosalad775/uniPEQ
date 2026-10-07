<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import DevicePanel from '$lib/components/device/DevicePanel.svelte';
	import DeviceSheet from '$lib/components/device/DeviceSheet.svelte';
	import ReviewDialog from '$lib/components/device/ReviewDialog.svelte';
	import SyncBar from '$lib/components/device/SyncBar.svelte';
	import BandList from '$lib/components/eq/BandList.svelte';
	import BandSheet from '$lib/components/eq/BandSheet.svelte';
	import EqAppBar from '$lib/components/eq/EqAppBar.svelte';
	import EqGraph from '$lib/components/eq/EqGraph.svelte';
	import PreampControl from '$lib/components/eq/PreampControl.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	/** The `wide:` breakpoint (layout.css): the band editor opens in the list, not in a sheet. */
	const wide = new MediaQuery('min-width: 56.25rem');
	const sheetOpen = $derived(!wide.current && eqStore.selected !== null);

	let deviceOpen = $state(false);
</script>

<!--
	Decision 22: the app bar, the graph and the sync bar hold still; only the bands scroll.
	Phone: app bar (device chip), graph, the band card (preamp + bands) scrolling, sync bar; the
	device panel is a sheet from the chip, the selected band's editor a sheet over the bottom.
	Wide: the graph fills the left column; the device panel and the band card scroll on the right,
	where the selected row opens the editor in place.
-->
<div class="flex h-full flex-col">
	<EqAppBar onDevice={() => (deviceOpen = true)} />
	<div
		class="flex min-h-0 flex-1 flex-col wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
	>
		<div class="h-[30dvh] min-h-44 shrink-0 px-2 pb-2 wide:h-auto wide:min-h-0 wide:px-4 wide:pb-4">
			<EqGraph />
		</div>
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 wide:pl-0">
			{#if wide.current}
				<DevicePanel />
			{/if}
			<div class="divide-y divide-base-content/10 rounded-xl bg-base-100">
				<PreampControl />
				<BandList inlineEditor={wide.current} />
			</div>
		</div>
	</div>
	<SyncBar />
</div>

{#if sheetOpen && eqStore.selected !== null}
	<BandSheet index={eqStore.selected} />
{/if}
{#if !wide.current}
	<DeviceSheet bind:open={deviceOpen} />
{/if}
<ReviewDialog />
