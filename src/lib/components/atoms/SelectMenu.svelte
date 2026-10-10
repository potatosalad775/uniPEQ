<!--
	One-of-N as a `Menu` of radio items, anchored to what opens it (rather than a radio dialog
	stacked on a sheet): a check marks the current choice, and picking one closes the menu. Pair it
	with a `ListRow` given the trigger props (`buttonProps`) that shows the current choice.
-->
<script lang="ts" generics="T extends string">
	import { Check } from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Menu from './Menu.svelte';

	let {
		value,
		options,
		onValueChange,
		label,
		trigger
	}: {
		value: T;
		options: readonly { value: T; label: string }[];
		onValueChange: (value: T) => void;
		/** Accessible name for the choices. */
		label: string;
		/** The element that opens the menu, given bits-ui's trigger props to spread on it. */
		trigger: Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<Menu {trigger}>
	<DropdownMenu.RadioGroup
		{value}
		onValueChange={(next) => {
			if (next && next !== value) onValueChange(next as T);
		}}
		aria-label={label}
	>
		{#each options as option (option.value)}
			<DropdownMenu.RadioItem
				value={option.value}
				class="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm outline-none select-none data-highlighted:bg-base-content/10 touch:min-h-12 touch:text-base"
			>
				{#snippet children({ checked })}
					<span class="min-w-0 flex-1 truncate {checked ? 'font-medium text-primary' : ''}">
						{option.label}
					</span>
					<Check
						class="size-4 shrink-0 text-primary {checked ? '' : 'invisible'}"
						aria-hidden="true"
					/>
				{/snippet}
			</DropdownMenu.RadioItem>
		{/each}
	</DropdownMenu.RadioGroup>
</Menu>
