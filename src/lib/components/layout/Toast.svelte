<!--
	The notice store's message, above the tab bar (phone) or at the bottom of the content (wide),
	under the update prompt when there is one. The live regions are always in the DOM, so screen
	readers hear each new message.
-->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';
	import * as m from '#lib/paraglide/messages.js';
	import { noticeStore } from '#lib/stores/notice-store.svelte.js';
	import UpdatePrompt from './UpdatePrompt.svelte';
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+var(--inset-bottom)+var(--toast-lift))] z-40 flex flex-col items-center gap-2 px-4 wide:bottom-[calc(1rem+var(--inset-bottom)+var(--toast-lift))] wide:pl-28"
>
	<UpdatePrompt />
	<div role="status" aria-live="polite" class="flex w-full justify-center empty:hidden">
		{#if noticeStore.text}
			<div
				transition:fade={{ duration: 150 }}
				class="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-3 py-2 text-sm shadow-lg
				{noticeStore.isError ? 'bg-error text-error-content' : 'bg-neutral text-neutral-content'}"
			>
				<p class="min-w-0 flex-1">{noticeStore.text}</p>
				<button
					type="button"
					class="shrink-0 rounded p-0.5 opacity-80 hover:opacity-100"
					aria-label={m.notice_dismiss()}
					onclick={() => noticeStore.clear()}
				>
					<X class="size-4" aria-hidden="true" />
				</button>
			</div>
		{/if}
	</div>
</div>
