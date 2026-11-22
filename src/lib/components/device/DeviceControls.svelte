<!--
	The device's settings besides the EQ (eqcaps `protocol.controls`): volume, gain, DAC filter, USB
	mode and the like, one row each in the profile's order (`ControlRows`), only those the device has
	now. Not the settings of one of its EQs (a headroom, a crossfeed): those are on the band card
	with that EQ (`EqSettings`), where their place says whose they are.
-->
<script lang="ts">
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
	import ControlRows from './ControlRows.svelte';

	const headingId = $props.id();
	const controls = $derived(devicePeqStore.deviceControls);
</script>

{#if controls.length > 0}
	<section aria-labelledby={headingId} class="flex flex-col gap-1 pt-4">
		<h3 id={headingId} class="text-xs font-semibold tracking-wide text-primary uppercase">
			{m.device_control_section()}
		</h3>
		<div class="-mx-4 flex flex-col divide-y divide-base-content/10">
			<ControlRows {controls} />
		</div>
	</section>
{/if}
