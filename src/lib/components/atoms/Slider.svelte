<!--
	A range input with a filled track and a finger-sized thumb under `touch:` (the `.range` styles in
	layout.css). Native underneath, so it keeps the slider role, keyboard steps and form behaviour;
	the input's height is the touch target (48 px on touch, 24 px with a mouse).
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		class: className = '',
		...rest
	}: Omit<HTMLInputAttributes, 'type' | 'value' | 'min' | 'max'> & {
		value?: number;
		min?: number;
		max?: number;
	} = $props();

	const fill = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
</script>

<input
	type="range"
	bind:value
	{min}
	{max}
	style:--fill="{fill}%"
	class="range block h-6 w-full touch:h-12 {className}"
	{...rest}
/>
