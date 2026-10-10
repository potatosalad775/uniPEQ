<script lang="ts">
	import type { Snippet } from 'svelte';

	let { class: className = '', children }: { class?: string; children: Snippet } = $props();

	let el: HTMLDivElement;
	/** One gutter's width: a classic scrollbar's (Chrome's `thin` is 11 px), 0 for an overlay one. */
	let gutter = $state(0);

	$effect(() => {
		// Both gutters are always reserved, so the difference is two of them, scrolling or not. A
		// zoom changes it, and resizes the box.
		const measure = () => (gutter = (el.offsetWidth - el.clientWidth) / 2);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

<!--
	A tab's scrolling area, below its pinned PageHeader. The shell's <main> doesn't scroll (the EQ tab
	scrolls its own panes), so a page that scrolls says so here. Gutters on both edges keep a classic
	scrollbar from shifting the content when it appears, and the padding gives their width back, so
	the content sits 16 px in on both sides, in line with the header, scrolling or not.
-->
<div
	bind:this={el}
	class="min-h-0 flex-1 scrollbar-gutter-both overflow-y-auto"
	style:--gutter="{gutter}px"
>
	<div class="px-[max(0px,calc(--spacing(4)-var(--gutter)))] {className}">
		{@render children()}
	</div>
</div>
