<!-- Copied from modernGraphTool src/lib/components/atoms/Input.svelte @ 23ddc4dd; its props also take
	the input element's own attributes (aria-label, inputmode, …), which it already spread. 48 px
	tall under `touch:` (decision 22). -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		icon,
		label,
		placeholder = '',
		value = $bindable(),
		class: className = '',
		type = 'text',
		...restProps
	}: Omit<HTMLInputAttributes, 'value' | 'type' | 'class' | 'placeholder'> & {
		icon?: Snippet;
		label?: string;
		placeholder?: string;
		value: string;
		type?: string;
		class?: string;
	} = $props();
</script>

<label class="flex w-full gap-2 text-sm font-medium text-base-content {className}">
	{#if label}
		<span>{label}</span>
	{/if}
	<div class="relative flex-1 gap-1">
		{#if icon}
			<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
				{@render icon()}
			</div>
		{/if}
		<input
			{type}
			bind:value
			{placeholder}
			class="block w-full rounded-md border border-base-content/20 px-3 py-2 focus:ring-1 focus:ring-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 touch:h-12 touch:rounded-lg touch:text-base {icon
				? 'pl-9'
				: ''}"
			{...restProps}
		/>
	</div>
</label>
