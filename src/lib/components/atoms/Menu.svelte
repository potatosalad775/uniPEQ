<!--
	A dropdown menu on bits-ui's DropdownMenu, the one look every menu in the app shares (decision
	23): the EQ tab's overflow, a preset's ⋮, and the value pickers (`SelectMenu`). Fill it with
	`MenuItem` and `MenuSeparator`. It never runs taller than the room under (or over) its trigger,
	clear of the system bars, nor than 60% of the screen: past that it scrolls. Android back closes
	it.
-->
<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { onBack } from '#lib/platform/back-button.js';
	import { safeInsets } from '#lib/platform/insets.js';

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

	/** Room kept free around the menu: 8 px past the status and navigation bars. */
	let collisionPadding = $state({ top: 8, right: 8, bottom: 8, left: 8 });

	$effect(() => {
		if (!open) return;
		const i = safeInsets();
		collisionPadding = {
			top: i.top + 8,
			right: i.right + 8,
			bottom: i.bottom + 8,
			left: i.left + 8
		};
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
			{collisionPadding}
			class="z-50 max-h-[min(var(--bits-floating-available-height),60dvh)] min-w-52 overflow-y-auto overscroll-y-contain rounded-xl border border-base-content/10 bg-base-100 p-1 shadow-xl {className}"
		>
			{@render children()}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
