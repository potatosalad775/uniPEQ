<!--
	One action in a `Menu`: an optional icon, the label, and an optional line of supporting text.
	48 px on touch, 40 px with a mouse. `destructive` colours it as the error tone (Delete).
-->
<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		onSelect,
		disabled = false,
		destructive = false,
		description,
		icon,
		children
	}: {
		onSelect: () => void;
		disabled?: boolean;
		destructive?: boolean;
		description?: string;
		icon?: Snippet;
		children: Snippet;
	} = $props();
</script>

<DropdownMenu.Item
	{disabled}
	onSelect={() => onSelect()}
	class="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-base-content/10 touch:min-h-12 touch:text-base
		{destructive ? 'text-error' : ''}"
>
	{@render icon?.()}
	{#if description}
		<span class="flex flex-col">
			{@render children()}
			<span class="text-xs text-base-content/60">{description}</span>
		</span>
	{:else}
		{@render children()}
	{/if}
</DropdownMenu.Item>
