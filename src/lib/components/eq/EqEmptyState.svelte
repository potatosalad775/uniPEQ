<!--
	The EQ tab before any device (decision 23): uniPEQ edits a device's EQ, so there is nothing to
	edit until one is connected; its profile brings the band count and limits. Connect opens the
	device sheet (phone; on `wide:` the device panel is beside this, so it isn't offered), and the
	demo device is one press away for trying the app without hardware.
-->
<script lang="ts">
	import { FlaskConical, Usb } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import * as m from '$lib/paraglide/messages';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';

	let {
		onConnect
	}: { /** Open the device sheet; omitted where the panel is in view. */ onConnect?: () => void } =
		$props();
</script>

<section
	aria-labelledby="eq-empty-heading"
	class="flex h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center"
>
	<span
		class="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"
		aria-hidden="true"
	>
		<Usb class="size-8" />
	</span>
	<div class="flex max-w-sm flex-col gap-1.5">
		<h2 id="eq-empty-heading" class="text-lg font-semibold">{m.eq_empty_title()}</h2>
		<p class="text-sm text-base-content/70">{m.eq_empty_body()}</p>
	</div>
	<div class="flex w-full max-w-xs flex-col gap-2">
		{#if onConnect}
			<Button
				title={m.device_chip_connect()}
				class="gap-2"
				onpointerenter={() => devicePeqService.warmUp()}
				onclick={onConnect}
			>
				<Usb class="size-4" aria-hidden="true" />
				{m.device_chip_connect()}
			</Button>
		{/if}
		<Button
			title={m.device_peq_connect_demo_title()}
			variant="ghost"
			class="gap-2"
			disabled={devicePeqStore.isConnecting}
			onclick={() => devicePeqService.connect('demo')}
		>
			<FlaskConical class="size-4" aria-hidden="true" />
			{m.device_peq_connect_demo()}
		</Button>
	</div>
</section>
