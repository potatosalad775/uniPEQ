<!--
	The device in the EQ tab's app bar (decision 22): its name and a dot for whether it has the EQ
	on screen (the sync bar's state; a disconnected device's is the warning tone), or "Connect
	device" before any. The page decides what a press does: connect, or open the device sheet.
-->
<script lang="ts">
	import { ChevronDown, Usb } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';

	let { onclick }: { onclick: () => void } = $props();

	const connected = $derived(devicePeqStore.connection !== null);

	/** The connected device, or the one the EQ is still for after a disconnect. */
	const name = $derived(devicePeqStore.knownDevice?.name ?? null);
	const tone = $derived(devicePeqService.sync?.tone ?? 'muted');

	const dotClass = {
		muted: 'bg-base-content/40',
		success: 'bg-success',
		warning: 'bg-warning',
		error: 'bg-error',
		busy: 'bg-primary animate-pulse',
		pending: 'bg-primary animate-pulse'
	} as const;
</script>

<button
	type="button"
	class="flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full border border-base-content/15 bg-base-100 pr-3 pl-3 text-sm font-medium hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:bg-base-content/10"
	title={name ? m.device_chip_title({ device: name }) : m.device_chip_connect()}
	aria-haspopup={connected ? 'dialog' : undefined}
	onpointerenter={() => devicePeqService.warmUp()}
	{onclick}
>
	{#if name}
		<span class="size-2.5 shrink-0 rounded-full {dotClass[tone]}" aria-hidden="true"></span>
		<span class="min-w-0 truncate">{name}</span>
	{:else}
		<Usb class="size-4 shrink-0 text-primary" aria-hidden="true" />
		<span class="min-w-0 truncate">
			{devicePeqStore.isConnecting ? m.device_peq_connecting() : m.device_chip_connect()}
		</span>
	{/if}
	{#if connected}
		<ChevronDown class="size-4 shrink-0 text-base-content/60" aria-hidden="true" />
	{/if}
</button>
