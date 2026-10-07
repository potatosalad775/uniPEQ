<!--
	One-of-N in a dialog, Android's pattern for a setting with a few choices (decision 22): a row
	per option with a radio, and picking one closes the dialog. Pair it with a ListRow that shows
	the current choice and opens this.
-->
<script lang="ts" generics="T extends string">
	import { RadioGroup } from 'bits-ui';
	import ModalDialog from './ModalDialog.svelte';

	let {
		open = $bindable(false),
		title,
		value,
		options,
		onValueChange
	}: {
		open?: boolean;
		title: string;
		value: T;
		options: readonly { value: T; label: string; description?: string }[];
		onValueChange: (value: T) => void;
	} = $props();
</script>

<ModalDialog bind:open {title} class="gap-2 pb-4">
	<RadioGroup.Root
		{value}
		onValueChange={(next) => {
			if (next && next !== value) onValueChange(next as T);
			open = false;
		}}
		aria-label={title}
		class="-mx-4 flex flex-col"
	>
		{#each options as option (option.value)}
			<RadioGroup.Item
				value={option.value}
				class="group flex min-h-12 w-full cursor-pointer items-center gap-4 rounded-lg px-4 py-2 text-left hover:bg-base-content/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none touch:min-h-14"
			>
				<span
					class="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-base-content/50 group-data-[state=checked]:border-primary"
					aria-hidden="true"
				>
					<span
						class="size-2.5 rounded-full bg-primary opacity-0 group-data-[state=checked]:opacity-100"
					></span>
				</span>
				<span class="flex min-w-0 flex-col">
					<span class="text-sm touch:text-base">{option.label}</span>
					{#if option.description}
						<span class="text-xs text-base-content/60">{option.description}</span>
					{/if}
				</span>
			</RadioGroup.Item>
		{/each}
	</RadioGroup.Root>
</ModalDialog>
