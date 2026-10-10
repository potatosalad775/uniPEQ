<!--
	The EQ tab's sync bar: whether the device has the EQ on screen, always in view at
	the bottom, and the one action that would change that (Write, Review, Reconnect). An auto-write
	waiting to fire shows a ring that runs out with the delay. Hidden before any device; after a
	disconnect it says so and offers Connect. It is the
	device's one status line (device-peq invariant 6): the live region screen readers hear.
-->
<script lang="ts">
	import { Check, CircleAlert, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { SyncAction } from '$lib/device-peq/sync-status';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { settingsStore } from '$lib/stores/settings-store.svelte';

	let {
		onConnect,
		class: className = ''
	}: {
		/** The device chip's press (phone). Without it, Connect isn't offered: the panel is in view. */
		onConnect?: () => void;
		class?: string;
	} = $props();

	const status = $derived(devicePeqService.sync);
	const actions = $derived(
		(status?.actions ?? []).filter((a) => a !== 'connect' || onConnect !== undefined)
	);

	const toneClass = {
		muted: 'text-base-content/70',
		success: 'text-base-content',
		warning: 'text-base-content',
		error: 'text-error',
		busy: 'text-base-content/80',
		pending: 'text-base-content/80'
	} as const;

	const ACTION_LABEL = {
		read: m.sync_read,
		write: m.sync_write,
		review: m.device_peq_auto_review,
		reconnect: m.device_peq_reconnect,
		connect: m.sync_connect
	} as const;

	function act(action: SyncAction) {
		if (action === 'connect') onConnect?.();
		else if (action === 'reconnect') void devicePeqService.reconnect();
		else if (action === 'read') void devicePeqService.read();
		else void devicePeqService.requestWrite();
	}

	/** The ring's run, from now to the due time, restarted for each new edit. */
	const ringMs = $derived(
		status?.dueAt ? Math.max(0, status.dueAt - Date.now()) : settingsStore.autoPushDelayMs
	);
</script>

<div
	data-sync-bar
	class="flex min-h-12 items-center gap-3 border-t border-base-content/10 bg-base-100 px-4 py-1.5 touch:min-h-14 {status
		? ''
		: 'hidden'} {className}"
>
	<span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
		{#if status?.tone === 'busy'}
			<LoaderCircle class="size-5 animate-spin text-primary" />
		{:else if status?.tone === 'pending'}
			{#key status.dueAt}
				<svg viewBox="0 0 20 20" class="size-5 -rotate-90">
					<circle
						cx="10"
						cy="10"
						r="8"
						class="fill-none stroke-base-content/15"
						stroke-width="2.5"
					/>
					<circle
						cx="10"
						cy="10"
						r="8"
						pathLength="100"
						stroke-dasharray="100"
						class="sync-ring fill-none stroke-primary"
						stroke-width="2.5"
						style:animation-duration="{ringMs}ms"
					/>
				</svg>
			{/key}
		{:else if status?.tone === 'success'}
			<Check class="size-5 text-success" />
		{:else if status?.tone === 'error'}
			<CircleAlert class="size-5 text-error" />
		{:else if status?.tone === 'warning'}
			<TriangleAlert class="size-5 text-warning" />
		{:else}
			<span class="size-2 rounded-full bg-base-content/40"></span>
		{/if}
	</span>
	<p
		class="min-w-0 flex-1 text-sm leading-snug {status ? toneClass[status.tone] : ''}"
		role="status"
	>
		{status?.text ?? ''}
	</p>
	{#each actions as action, i (action)}
		{@const main = i === actions.length - 1}
		<Button
			title={ACTION_LABEL[action]()}
			size="sm"
			variant={main && action === 'write' ? 'primary' : main ? 'outline' : 'ghost'}
			class="shrink-0"
			disabled={devicePeqStore.isBusy || devicePeqStore.isConnecting}
			onclick={() => act(action)}
		>
			{ACTION_LABEL[action]()}
		</Button>
	{/each}
</div>

<style>
	/* The ring drains from full to empty over the auto-write delay. */
	.sync-ring {
		animation-name: drain;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}

	@keyframes drain {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: 100;
		}
	}
</style>
