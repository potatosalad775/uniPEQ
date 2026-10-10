<!--
	"A new version is ready", with Reload, while `updateStore` holds an update. Stays until the user
	reloads or dismisses it: reloading drops a device connection, so it never happens by itself.
	Shown in the toast stack (Toast.svelte).
-->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';
	import Button from '$lib/components/atoms/Button.svelte';
	import * as m from '$lib/paraglide/messages';
	import { updateStore } from '$lib/stores/update-store.svelte';
</script>

<div role="status" aria-live="polite" class="flex w-full justify-center empty:hidden">
	{#if updateStore.ready}
		<div
			transition:fade={{ duration: 150 }}
			class="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg bg-neutral py-1.5 pr-1.5 pl-3 text-sm text-neutral-content shadow-lg"
		>
			<p class="min-w-0 flex-1">{m.update_ready()}</p>
			<Button
				variant="ghost"
				size="sm"
				class="text-neutral-content hover:bg-neutral-content/10"
				title={m.update_reload()}
				onclick={() => updateStore.apply()}
			>
				{m.update_reload()}
			</Button>
			<button
				type="button"
				class="shrink-0 rounded p-0.5 opacity-80 hover:opacity-100"
				aria-label={m.notice_dismiss()}
				onclick={() => updateStore.dismiss()}
			>
				<X class="size-4" aria-hidden="true" />
			</button>
		</div>
	{/if}
</div>
