<!--
	A small status pill: the build label, auto preamp, a profile's status, a preset's fit or tag.
	Not interactive (a pressable pill is ChipGroup or DeviceChip); the tone is its colour, so the
	text has to say the same thing on its own. A fixed height with `leading-none` rather than padding
	around an inherited line-height, which left the box a fractional height that depended on the
	parent and the baseline rounded off-centre.
-->
<script lang="ts" module>
	export type BadgeTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone = 'neutral',
		title,
		class: className = '',
		children
	}: {
		tone?: BadgeTone;
		title?: string;
		class?: string;
		/** The label, optionally after a `size-3` icon. */
		children: Snippet;
	} = $props();

	const toneClasses: Record<BadgeTone, string> = {
		neutral: 'bg-base-300 text-base-content/80',
		primary: 'bg-primary/15 text-primary',
		info: 'bg-info/15 text-info',
		success: 'bg-success/15 text-success',
		warning: 'bg-warning/15 text-warning',
		error: 'bg-error/15 text-error'
	};
</script>

<span
	class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap {toneClasses[
		tone
	]} {className}"
	{title}
>
	{@render children()}
</span>
