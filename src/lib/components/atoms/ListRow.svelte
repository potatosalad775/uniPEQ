<!--
	One row of a settings-style list: a label, optional supporting text under it, and
	a trailing control or value. The whole row is the target:
	- `onclick`: the row is a button (a row that opens a dialog or a sheet);
	- `buttonProps`: the row is a button carrying these props (a `Menu`'s trigger props);
	- `href`: the row is a link, opened outside the app;
	- `for`: the row is the label of the control with that id (a switch), so tapping anywhere
	  toggles it;
	- neither: a plain row (a slider row, a read-only value).
	At least 56 px tall on touch, 48 px with a mouse.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		description,
		for: htmlFor,
		onclick,
		buttonProps,
		href,
		disabled = false,
		leading,
		trailing,
		children,
		class: className = ''
	}: {
		label: string;
		description?: string;
		/** The id of the control this row labels. */
		for?: string;
		onclick?: () => void;
		/** Spread on the row's button: what a `Menu` or `SelectMenu` hands its trigger. */
		buttonProps?: Record<string, unknown>;
		/** An external page. */
		href?: string;
		disabled?: boolean;
		leading?: Snippet;
		/** The control or value at the row's end. */
		trailing?: Snippet;
		/** Content under the label row, full width (a slider). */
		children?: Snippet;
		class?: string;
	} = $props();

	const base =
		'flex w-full min-h-12 items-center gap-3 px-4 py-2 text-left touch:min-h-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset';
	const interactive = $derived(
		disabled ? 'opacity-50' : 'cursor-pointer hover:bg-base-content/5 active:bg-base-content/10'
	);
</script>

{#snippet body()}
	{#if leading}<span class="flex shrink-0 items-center">{@render leading()}</span>{/if}
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="text-sm text-base-content touch:text-base">{label}</span>
		{#if description}
			<span class="text-xs text-base-content/60 touch:text-sm">{description}</span>
		{/if}
	</span>
{/snippet}

<div class={className}>
	{#if onclick || buttonProps}
		<button type="button" {onclick} {...buttonProps} class="{base} {interactive}" {disabled}>
			{@render body()}
			{#if trailing}
				<span class="flex shrink-0 items-center text-sm text-base-content/70">
					{@render trailing()}
				</span>
			{/if}
		</button>
	{:else if href}
		<!-- External: `resolve()` is for app routes. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a {href} target="_blank" rel="noopener noreferrer" class="{base} {interactive}">
			{@render body()}
			{#if trailing}
				<span class="flex shrink-0 items-center text-sm text-base-content/70">
					{@render trailing()}
				</span>
			{/if}
		</a>
	{:else}
		<!--
			A label row: the switch sits inside it, so a tap anywhere toggles it (a tap on the switch
			itself doesn't toggle twice: a label ignores clicks on interactive content inside it).
		-->
		<svelte:element
			this={htmlFor ? 'label' : 'div'}
			for={htmlFor}
			class="{base} {htmlFor ? interactive : disabled ? 'opacity-50' : ''}"
		>
			{@render body()}
			{#if trailing}
				<span class="flex shrink-0 items-center text-sm text-base-content/70">
					{@render trailing()}
				</span>
			{/if}
		</svelte:element>
	{/if}
	{#if children}
		<div class="-mt-2 px-4 pb-2">{@render children()}</div>
	{/if}
</div>
