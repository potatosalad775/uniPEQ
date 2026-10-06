<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, actions }: { title: string; actions?: Snippet } = $props();
</script>

<header class="flex min-h-14 items-center gap-2 px-4">
	<h1 class="flex-1 truncate text-lg font-semibold">{title}</h1>
	{@render actions?.()}
</header>
