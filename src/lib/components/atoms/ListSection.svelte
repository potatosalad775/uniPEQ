<!--
	A titled group of ListRows: a small heading above a card whose rows are divided by
	hairlines, as Android settings screens group theirs.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		children,
		class: className = ''
	}: { title?: string; children: Snippet; class?: string } = $props();

	const id = $props.id();
</script>

<section aria-labelledby={title ? id : undefined} class="flex flex-col gap-1.5 {className}">
	{#if title}
		<h2 {id} class="px-4 text-xs font-semibold tracking-wide text-primary uppercase">{title}</h2>
	{/if}
	<div class="divide-y divide-base-content/10 overflow-hidden rounded-xl bg-base-100">
		{@render children()}
	</div>
</section>
