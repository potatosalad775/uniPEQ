<!--
	The self-check's one-time tip: Android paused (or killed) uniPEQ while it was linked, or its
	battery use is Restricted. A dialog rather than the sync bar's one line: it explains a system
	setting and sends the user to it, and the bar's device messages would bury it. It waits while
	"Link with <host>?" is open, so the two never stack. Closing it (Android back, the scrim) is
	Not now. Mounted once in the shell: the tip can come up on any tab.
-->
<script lang="ts">
	import Button from '$lib/components/atoms/Button.svelte';
	import ModalDialog from '$lib/components/atoms/ModalDialog.svelte';
	import { linkStore } from '$lib/link/link-store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { openAppSettings } from '$lib/platform/link';

	function close(settings: boolean) {
		linkStore.batteryTip = false;
		if (settings) openAppSettings();
	}
</script>

<ModalDialog
	bind:open={
		() => linkStore.batteryTip && linkStore.approval === null, (open) => !open && close(false)
	}
	title={m.link_battery_title()}
	description={m.link_battery_tip()}
>
	{#snippet footer()}
		<Button title={m.link_battery_later()} variant="ghost" onclick={() => close(false)}>
			{m.link_battery_later()}
		</Button>
		<Button title={m.link_battery_settings()} onclick={() => close(true)}>
			{m.link_battery_settings()}
		</Button>
	{/snippet}
</ModalDialog>
