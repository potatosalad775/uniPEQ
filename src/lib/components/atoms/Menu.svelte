<!--
	A dropdown menu on bits-ui's DropdownMenu, the one look every menu in the app shares (decision
	23): the EQ tab's overflow, a preset's ⋮, and the value pickers (`SelectMenu`). Fill it with
	`MenuItem` and `MenuSeparator`. It never runs taller than the room under (or over) its trigger:
	past that it scrolls. Android back closes it.
-->
<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { onBack } from '$lib/platform/back-button';

	let {
		open = $bindable(false),
		trigger,
		children,
		align = 'end',
		class: className = ''
	}: {
		open?: boolean;
		/** The element that opens the menu, given bits-ui's trigger props to spread on it. */
		trigger: Snippet<[Record<string, unknown>]>;
		children: Snippet;
		align?: 'start' | 'center' | 'end';
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

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render trigger(props)}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			{align}
			sideOffset={4}
			collisionPadding={8}
			class="z-50 max-h-(--bits-floating-available-height) min-w-52 overflow-y-auto rounded-xl border border-base-content/10 bg-base-100 p-1 shadow-xl {className}"
		>
			{@render children()}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
