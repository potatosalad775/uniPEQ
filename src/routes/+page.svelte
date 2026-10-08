<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import DevicePanel from '$lib/components/device/DevicePanel.svelte';
	import DeviceSheet from '$lib/components/device/DeviceSheet.svelte';
	import ReviewDialog from '$lib/components/device/ReviewDialog.svelte';
	import SyncBar from '$lib/components/device/SyncBar.svelte';
	import BandList from '$lib/components/eq/BandList.svelte';
	import BandSheet from '$lib/components/eq/BandSheet.svelte';
	import EqAppBar from '$lib/components/eq/EqAppBar.svelte';
	import EqEmptyState from '$lib/components/eq/EqEmptyState.svelte';
	import EqGraph from '$lib/components/eq/EqGraph.svelte';
	import PreampControl from '$lib/components/eq/PreampControl.svelte';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	/** The `wide:` breakpoint (layout.css): the band editor opens in the list, not in a sheet. */
	const wide = new MediaQuery('min-width: 56.25rem');
	const hasDevice = $derived(eqConstraintStore.hasDevice);
	const sheetOpen = $derived(hasDevice && !wide.current && eqStore.selected !== null);

	let deviceOpen = $state(false);
	const openDevice = () => (deviceOpen = true);
</script>

<!--
	Decision 22: the app bar, the graph and the sync bar hold still; only the bands scroll.
	Phone: app bar (device chip), the graph edge to edge (pinned chrome, not a card), the band card
	(preamp + bands) scrolling, sync bar; the device panel is a sheet from the chip, the selected
	band's editor a sheet over the bottom.
	Wide: the graph fills the left column; the device panel and the band card scroll on the right,
	where the selected row opens the editor in place.
	Decision 23: before any device there is nothing to edit, so the graph and the band card give way
	to a prompt to connect one.
-->
<div class="flex h-full flex-col">
	<EqAppBar onDevice={openDevice} />
	<div
		class="flex min-h-0 flex-1 flex-col wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
	>
		{#if hasDevice}
			<div
				class="h-[30dvh] min-h-44 shrink-0 border-b border-base-content/10 wide:h-auto wide:min-h-0 wide:border-0 wide:px-4 wide:pb-4"
			>
				<EqGraph />
			</div>
		{:else}
			<div class="min-h-0 flex-1 wide:px-4 wide:pb-4">
				<div class="h-full overflow-y-auto wide:rounded-xl wide:bg-base-100">
					<EqEmptyState onConnect={wide.current ? undefined : openDevice} />
				</div>
			</div>
		{/if}
		{#if wide.current || hasDevice}
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 wide:pt-0 wide:pl-0">
				{#if wide.current}
					<DevicePanel />
				{/if}
				{#if hasDevice}
					<div class="divide-y divide-base-content/10 rounded-xl bg-base-100">
						<PreampControl inlineEditor={wide.current} />
						<BandList inlineEditor={wide.current} />
					</div>
				{/if}
			</div>
		{/if}
	</div>
	<SyncBar onConnect={wide.current ? undefined : openDevice} />
</div>

{#if sheetOpen && eqStore.selected !== null}
	<BandSheet index={eqStore.selected} />
{/if}
{#if !wide.current}
	<DeviceSheet bind:open={deviceOpen} />
{/if}
<ReviewDialog />
