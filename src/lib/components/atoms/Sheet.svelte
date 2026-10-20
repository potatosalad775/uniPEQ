<!--
	A bottom sheet. Android back, or the close button, closes it.
	- `modal` (default): bits-ui Dialog under a scrim, focus held inside (the device sheet).
	- not modal: a panel over the bottom of the screen with the page above it still live (the band
	  editor, so a graph node can still be dragged while it is up).
	On `wide:` a modal sheet is a card centred at the bottom, not edge to edge.
-->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { onBack } from '#lib/platform/back-button.js';
	import Button from './Button.svelte';

	let {
		open = $bindable(false),
		title,
		modal = true,
		hideTitle = false,
		actions,
		children,
		class: className = ''
	}: {
		open?: boolean;
		title: string;
		modal?: boolean;
		/** Keep the title for screen readers only, when `actions` carry their own heading. */
		hideTitle?: boolean;
		/** Buttons in the header, before the close button. */
		actions?: Snippet;
		children: Snippet;
		class?: string;
	} = $props();

	$effect(() => {
		if (!open) return;
		return onBack(() => {
			open = false;
			return true;
		});
	});

	const panel =
		'flex max-h-[85dvh] flex-col rounded-t-2xl bg-base-100 pt-2 pr-[calc(1rem+var(--inset-right))] pb-[calc(1rem+var(--inset-bottom))] pl-[calc(1rem+var(--inset-left))] shadow-[0_-8px_24px_rgb(0_0_0/0.15)] animate-sheet-in';
</script>

{#snippet header(Title: typeof Dialog.Title | null)}
	<div
		class="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-base-content/20"
		aria-hidden="true"
	></div>
	<div class="flex shrink-0 items-center gap-1 pb-4">
		{#if Title}
			<Title class="min-w-0 flex-1 truncate text-base font-semibold {hideTitle ? 'sr-only' : ''}">
				{title}
			</Title>
		{:else}
			<h2 class="min-w-0 flex-1 truncate text-base font-semibold {hideTitle ? 'sr-only' : ''}">
				{title}
			</h2>
		{/if}
		{@render actions?.()}
		<Button title={m.dialog_close()} size="icon-sm" variant="ghost" onclick={() => (open = false)}>
			<X class="size-4" aria-hidden="true" />
		</Button>
	</div>
{/snippet}

{#if modal}
	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 z-40 animate-fade-in bg-black/40" />
			<Dialog.Content
				class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full wide:bottom-4 wide:max-w-lg wide:rounded-2xl {panel} {className}"
			>
				{@render header(Dialog.Title)}
				<div class="-mx-4 min-h-0 overflow-y-auto overscroll-y-contain px-4">
					{@render children()}
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{:else if open}
	<div
		role="dialog"
		aria-modal="false"
		aria-label={title}
		class="fixed inset-x-0 bottom-0 z-30 {panel} {className}"
	>
		{@render header(null)}
		<div class="-mx-4 min-h-0 overflow-y-auto overscroll-y-contain px-4">{@render children()}</div>
	</div>
{/if}
