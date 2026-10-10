<!--
	The device panel in a modal bottom sheet, opened from the device chip on a phone,
	or by a connect from the chip that needs a pick or has something to say. It closes itself once a
	connect attempt has connected, so the EQ is in view again.
-->
<script lang="ts">
	import Sheet from '$lib/components/atoms/Sheet.svelte';
	import * as m from '$lib/paraglide/messages';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import DevicePanel from './DevicePanel.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let wasConnected = devicePeqStore.isConnected;
	$effect(() => {
		const connected = devicePeqStore.isConnected;
		if (connected && !wasConnected) open = false;
		wasConnected = connected;
	});
</script>

<Sheet bind:open title={m.device_peq_label()}>
	<div class="pb-2"><DevicePanel heading={false} /></div>
</Sheet>
