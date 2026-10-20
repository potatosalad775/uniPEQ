<!--
	A modal dialog on bits-ui's Dialog: title, optional description, body and a footer of actions.
	Android back closes it. Not from modernGraphTool (it has no generic dialog); styled like
	PushDialog was.
-->
<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { onBack } from '#lib/platform/back-button.js';

	let {
		open = $bindable(false),
		title,
		description,
		children,
		footer,
		class: className = ''
	}: {
		open?: boolean;
		title: string;
		description?: string;
		children?: Snippet;
		footer?: Snippet;
		class?: string;
	} = $props();

	$effect(() => {
		if (!open) return;
		return onBack(() => {
			open = false;
			return true;
		});
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
		<Dialog.Content
			class="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-11/12 max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl bg-base-200 p-6 shadow-2xl {className}"
		>
			<Dialog.Title class="text-lg font-semibold text-base-content">{title}</Dialog.Title>
			{#if description}
				<Dialog.Description class="text-sm text-base-content/70">{description}</Dialog.Description>
			{/if}
			{@render children?.()}
			{#if footer}
				<div class="-mb-2 flex justify-end gap-2">{@render footer()}</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
