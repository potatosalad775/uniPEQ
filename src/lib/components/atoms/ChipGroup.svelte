<!--
	One-of-N as a row of pill chips that scrolls sideways when it runs out of room (decision 22): the
	band editor's filter types, which can be eight. bits-ui's single ToggleGroup underneath, as in
	SegmentedControl: radio semantics, arrow-key focus, and always one value.
-->
<script lang="ts" generics="T extends string">
	import { ToggleGroup } from 'bits-ui';

	let {
		value,
		options,
		onValueChange,
		label,
		invalid = false,
		class: className = ''
	}: {
		value: T;
		options: readonly { value: T; label: string; title?: string }[];
		onValueChange: (value: T) => void;
		/** Accessible name for the group. */
		label: string;
		/** The value is one the device won't take. */
		invalid?: boolean;
		class?: string;
	} = $props();
</script>

<ToggleGroup.Root
	type="single"
	bind:value={
		() => value,
		(next) => {
			if (next && next !== value) onValueChange(next as T);
		}
	}
	aria-label={label}
	class="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 py-0.5 {className}"
>
	{#each options as option (option.value)}
		<ToggleGroup.Item
			value={option.value}
			title={option.title}
			class="shrink-0 cursor-pointer rounded-full border border-base-content/20 px-3 py-1 text-xs font-medium text-base-content/80 hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-content touch:min-h-9 touch:px-4 touch:text-sm
				{invalid ? 'data-[state=on]:border-error data-[state=on]:bg-error' : ''}"
		>
			{option.label}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
