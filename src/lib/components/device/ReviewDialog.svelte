<!--
	The review before a write the device can't hold exactly (`devicePeqService.review`), wherever
	the write was asked for: the device panel's Write, or the sync bar's Write or Review.
-->
<script lang="ts">
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import PushDialog from './PushDialog.svelte';
</script>

<PushDialog
	bind:open={
		() => devicePeqService.review !== null, (open) => !open && devicePeqService.confirmReview(false)
	}
	plan={devicePeqService.review}
	deviceName={devicePeqStore.deviceName ?? ''}
	onConfirm={() => devicePeqService.confirmReview(true)}
/>
