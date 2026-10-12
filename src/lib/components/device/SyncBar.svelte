<!--
	The EQ tab's status bar: whether the device has the EQ on screen, always in view at the
	bottom, and the one action that would change that (Write, Review, Reconnect). An auto-write
	waiting to fire shows a ring that runs out with the delay. Hidden before any device; after a
	disconnect it says so and offers Connect. The modernGraphTool link shares it while it waits on
	something (`link-status.ts` ranks the two). It is the one status line (device-peq invariant 6):
	the live region screen readers hear. A new line slides in over the old one, and the bar slides
	open and shut rather than shifting the bands under a finger.
-->
<script lang="ts">
	import { Check, CircleAlert, Link2, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import Button from '$lib/components/atoms/Button.svelte';
	import type { SyncAction } from '$lib/device-peq/sync-status';
	import { linkStatus, statusLine, type BarStatus } from '$lib/link/link-status';
	import { linkStore } from '$lib/link/link-store.svelte';
	import * as m from '$lib/paraglide/messages';
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

	const line = $derived(statusLine(devicePeqService.sync, linkStatus(linkStore)));
	/** The last line, still drawn while the bar slides shut. */
	let held: BarStatus | null = null;
	const status = $derived.by(() => {
		if (line) held = line;
		return line ?? held;
	});
	const actions = $derived(
		(line?.actions ?? []).filter((a) => a !== 'connect' || onConnect !== undefined)
	);
	const iconKey = $derived(status ? (status.link ? 'link' : status.tone) : '');

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

<!-- Shut, it is inert: nothing in it is read or focused while it slides away. -->
<div
	data-sync-bar
	data-open={line ? '' : undefined}
	inert={!line}
	class="grid transition-[grid-template-rows] duration-300 ease-out {line
		? 'grid-rows-[1fr]'
		: 'grid-rows-[0fr]'} {className}"
>
	<div class="min-h-0 overflow-hidden">
		<div
			class="flex min-h-12 items-center gap-3 border-t border-base-content/10 bg-base-100 px-4 py-1.5 touch:min-h-14"
		>
			<span class="grid size-5 shrink-0" aria-hidden="true">
				{#key iconKey}
					<span
						class="col-start-1 row-start-1 flex items-center justify-center"
						in:scale={{ start: 0.5, duration: 200 }}
						out:fade={{ duration: 120 }}
					>
						{#if status?.link}
							<Link2
								class="size-5 {status.tone === 'muted'
									? 'text-base-content/50'
									: status.tone === 'warning'
										? 'text-warning'
										: 'animate-pulse text-primary'}"
							/>
						{:else if status?.tone === 'busy'}
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
				{/key}
			</span>
			<!-- Each line is added to the live region as its own node: announced once, as it lands. -->
			<p class="grid min-w-0 flex-1 text-sm leading-snug" role="status">
				{#key status?.text}
					<span
						class="col-start-1 row-start-1 {status ? toneClass[status.tone] : ''}"
						in:fly={{ y: 12, duration: 220 }}
						out:fly={{ y: -12, duration: 160 }}
					>
						{status?.text ?? ''}
					</span>
				{/key}
			</p>
			{#each actions as action, i (action)}
				{@const main = i === actions.length - 1}
				<span class="shrink-0" in:fade={{ duration: 150 }}>
					<Button
						title={ACTION_LABEL[action]()}
						size="sm"
						variant={main && action === 'write' ? 'primary' : main ? 'outline' : 'ghost'}
						disabled={devicePeqStore.isBusy || devicePeqStore.isConnecting}
						onclick={() => act(action)}
					>
						{ACTION_LABEL[action]()}
					</Button>
				</span>
			{/each}
		</div>
	</div>
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
