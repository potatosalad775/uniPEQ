<script lang="ts">
	import BandTable from '$lib/components/device/BandTable.svelte';
	import DevicePanel from '$lib/components/device/DevicePanel.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<PageHeader title={m.nav_main()} />
<div class="flex flex-col gap-4 px-4 pb-4 wide:grid wide:grid-cols-2 wide:items-start">
	<DevicePanel />
	<BandTable />
</div>
