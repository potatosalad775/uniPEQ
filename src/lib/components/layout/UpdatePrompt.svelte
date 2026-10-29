<!--
	A newer version from `updateStore`: Reload for the web build's waiting service worker, Download
	(the GitHub release page) for the sideloaded APK. Stays until taken or dismissed: reloading drops
	a device connection, so it never happens by itself. Shown in the toast stack (Toast.svelte).
-->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';
	import Button from '#lib/components/atoms/Button.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { updateStore } from '#lib/stores/update-store.svelte.js';

	const buttonClass = 'text-neutral-content hover:bg-neutral-content/10';
</script>

<div role="status" aria-live="polite" class="flex w-full justify-center empty:hidden">
	{#if updateStore.current}
		{@const update = updateStore.current}
		<div
			transition:fade={{ duration: 150 }}
			class="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg bg-neutral py-1.5 pr-1.5 pl-3 text-sm text-neutral-content shadow-lg"
		>
			{#if update.kind === 'reload'}
				<p class="min-w-0 flex-1">{m.update_ready()}</p>
				<Button
					variant="ghost"
					size="sm"
					class={buttonClass}
					title={m.update_reload()}
					onclick={() => updateStore.apply()}
				>
					{m.update_reload()}
				</Button>
			{:else}
				<p class="min-w-0 flex-1">{m.update_available({ version: update.version })}</p>
				<Button
					variant="ghost"
					size="sm"
					class={buttonClass}
					title={m.update_download()}
					href={update.url}
					target="_blank"
					rel="noopener noreferrer"
					onclick={() => updateStore.apply()}
				>
					{m.update_download()}
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-xs"
				class="{buttonClass} shrink-0 opacity-80 hover:opacity-100"
				title={m.notice_dismiss()}
				onclick={() => updateStore.dismiss()}
			>
				<X class="size-4" aria-hidden="true" />
			</Button>
		</div>
	{/if}
</div>
