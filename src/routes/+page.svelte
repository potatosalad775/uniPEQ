<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import DevicePanel from '#lib/components/device/DevicePanel.svelte';
	import DeviceSheet from '#lib/components/device/DeviceSheet.svelte';
	import ReviewDialog from '#lib/components/device/ReviewDialog.svelte';
	import SyncBar from '#lib/components/device/SyncBar.svelte';
	import BandList from '#lib/components/eq/BandList.svelte';
	import BandSheet from '#lib/components/eq/BandSheet.svelte';
	import EqAppBar from '#lib/components/eq/EqAppBar.svelte';
	import EqEmptyState from '#lib/components/eq/EqEmptyState.svelte';
	import EqGraph from '#lib/components/eq/EqGraph.svelte';
	import PreampControl from '#lib/components/eq/PreampControl.svelte';
	import { canConnectUsb, devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';
	import PageBody from '#lib/components/layout/PageBody.svelte';

	/** The `wide:` breakpoint (layout.css): the band editor opens in the list, not in a sheet. */
	const wide = new MediaQuery('min-width: 56.25rem');
	const hasDevice = $derived(eqConstraintStore.hasDevice);
	const sheetOpen = $derived(
		eqConstraintStore.editable && !wide.current && eqStore.selected !== null
	);

	let deviceOpen = $state(false);

	/**
	 * The device chip (and Connect in the empty state and the sync bar). Before a connection the
	 * sheet would hold only the USB button, so this connects straight away; the sheet opens when the
	 * attempt has something to ask or say (below). Once connected, the sheet holds the controls.
	 */
	function onDevice() {
		if (devicePeqStore.connection || !canConnectUsb) deviceOpen = true;
		else if (!devicePeqStore.isConnecting) void devicePeqService.connect('hid');
	}

	// A connect that needs a pick (several devices or profiles), found nothing to drive, or failed
	// before the sync bar is there to say so: the sheet shows it.
	$effect(() => {
		if (wide.current || devicePeqStore.connection) return;
		const error = devicePeqStore.statusIsError && devicePeqService.sync === null;
		if (devicePeqService.choice || devicePeqService.notFound || error) deviceOpen = true;
	});
</script>

<!--
	The app bar, the graph and the sync bar hold still; only the bands scroll.
	Phone: app bar (device chip), the graph edge to edge (pinned chrome, not a card), the band card
	(preamp + bands) scrolling, sync bar; the device panel is a sheet from the chip, the selected
	band's editor a sheet over the bottom. Before a connection the chip connects directly.
	Wide: the graph fills the left column over the device panel; the band card scrolls on the right,
	where the selected row opens the editor in place.
	Before any device there is nothing to edit, so the graph and the band card give way
	to a prompt to connect one.
-->
<div class="flex h-full flex-col">
	<EqAppBar {onDevice} />
	<div
		class="flex min-h-0 flex-1 flex-col wide:grid wide:max-w-6xl {hasDevice
			? 'wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]'
			: 'wide:grid-cols-1'}"
	>
		<!-- No box on a phone (its children sit in the column); the left column when wide. -->
		<div class="contents wide:flex wide:min-h-0 wide:flex-col wide:gap-4 wide:px-4 wide:pb-4">
			{#if hasDevice}
				<div
					class="h-[30dvh] min-h-44 shrink-0 border-b border-base-content/10 wide:h-auto wide:min-h-0 wide:flex-1 wide:border-0"
				>
					<EqGraph />
				</div>
				{#if wide.current}
					<div class="max-h-[60%] shrink-0 overflow-y-auto overscroll-y-contain rounded-xl">
						<DevicePanel />
					</div>
				{/if}
			{:else}
				<div class="min-h-0 flex-1">
					<div class="h-full overflow-y-auto overscroll-y-contain wide:rounded-xl wide:bg-base-100">
						<EqEmptyState onConnect={onDevice} />
					</div>
				</div>
			{/if}
		</div>
		{#if hasDevice}
			<PageBody class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 wide:pt-0 wide:pl-0">
				<div class="divide-y divide-base-content/10 rounded-xl bg-base-100">
					<PreampControl inlineEditor={wide.current} />
					<BandList inlineEditor={wide.current} />
				</div>
			</PageBody>
		{/if}
	</div>
	<SyncBar onConnect={wide.current ? undefined : onDevice} />
</div>

{#if sheetOpen && eqStore.selected !== null}
	<BandSheet index={eqStore.selected} />
{/if}
{#if !wide.current}
	<DeviceSheet bind:open={deviceOpen} />
{/if}
<ReviewDialog />
