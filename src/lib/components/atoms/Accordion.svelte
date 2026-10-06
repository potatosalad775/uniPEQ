<!-- Copied from modernGraphTool src/lib/components/atoms/Accordion.svelte @ 23ddc4dd. -->
<script lang="ts">
	import { Accordion, type WithChildren } from 'bits-ui';

	let { children, ...restProps }: WithChildren<Accordion.RootProps> = $props();
</script>

<Accordion.Root {...restProps}>
	{@render children?.()}
</Accordion.Root>
