<!--
	The volume warning before the first write on a connection (`devicePeqService.volumeWarning`): a
	write can pop or jump in level while audio plays. Nothing is written until it is answered, here
	or in a linked modernGraphTool. Closing it (Android back, the scrim) is Not now. Mounted once in
	the shell: a write can be asked for from any tab.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	let quiet = $state(false);
</script>

<ModalDialog
	bind:open={
		() => devicePeqService.volumeWarning,
		(open) => !open && devicePeqService.answerVolumeWarning(false)
	}
	title={m.device_peq_volume_title()}
	description={m.device_peq_volume_body({ device: devicePeqStore.deviceName ?? '' })}
>
	<label class="flex items-center gap-2 text-sm text-base-content/80">
		<input type="checkbox" class="size-4 accent-primary" bind:checked={quiet} />
		{m.device_peq_volume_quiet()}
	</label>
	{#snippet footer()}
		<Button
			title={m.device_peq_volume_later()}
			variant="ghost"
			onclick={() => devicePeqService.answerVolumeWarning(false)}
		>
			{m.device_peq_volume_later()}
		</Button>
		<Button
			title={m.device_peq_volume_continue()}
			onclick={() => devicePeqService.answerVolumeWarning(true, quiet)}
		>
			{m.device_peq_volume_continue()}
		</Button>
	{/snippet}
</ModalDialog>
