<!--
	The EQ tab before any device: uniPEQ edits a device's EQ, so there is nothing to
	edit until one is connected; its profile brings the band count and limits. Connect does what the
	device chip does (phone; on `wide:` the device panel is beside this, so it isn't offered), and
	the demo device is one press away for trying the app without hardware (in every build, decision
	26: store reviewers have no PEQ device either). Where no device can be reached, it says why and
	what to do instead (an Android browser: get the app), on every visit; the demo stays.
-->
<script lang="ts">
	import { FlaskConical, Usb } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import { environmentCopy } from '$lib/components/intro/environment-copy';
	import * as m from '$lib/paraglide/messages';
	import { ANDROID_DOWNLOAD_URL, environment } from '$lib/platform/environment';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';

	let {
		onConnect
	}: {
		/** The device chip's press; omitted where the panel is in view. */ onConnect?: () => void;
	} = $props();

	const notice = environmentCopy(environment);
	const Icon = notice?.icon ?? Usb;
</script>

<section
	aria-labelledby="eq-empty-heading"
	class="flex h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center"
>
	<span
		class="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"
		aria-hidden="true"
	>
		<Icon class="size-8" />
	</span>
	<div class="flex max-w-sm flex-col gap-1.5">
		<h2 id="eq-empty-heading" class="text-lg font-semibold">
			{notice?.title ?? m.eq_empty_title()}
		</h2>
		<p class="text-sm text-base-content/70">{notice?.body ?? m.eq_empty_body()}</p>
	</div>
	<div class="flex w-full max-w-xs flex-col gap-2">
		{#if environment === 'android'}
			<Button
				title={m.env_download()}
				href={ANDROID_DOWNLOAD_URL}
				target="_blank"
				rel="noopener noreferrer"
			>
				{m.env_download()}
			</Button>
		{:else if onConnect && !notice}
			<Button
				title={m.device_chip_connect()}
				class="gap-2"
				onpointerenter={() => devicePeqService.warmUp()}
				disabled={devicePeqStore.isConnecting}
				onclick={onConnect}
			>
				<Usb class="size-4" aria-hidden="true" />
				{devicePeqStore.isConnecting ? m.device_peq_connecting() : m.device_chip_connect()}
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
