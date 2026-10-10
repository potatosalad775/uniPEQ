<!--
	Marks a dev or debug build in each tab's header, so a screenshot or a phone on the desk says
	which one it is. Nothing in a release.
-->
<script lang="ts">
	import Badge from '$lib/components/atoms/Badge.svelte';
	import { buildLabel } from '$lib/platform/build';
</script>

{#if buildLabel}
	<Badge tone="warning" title="{buildLabel} build ({__APP_VERSION__})">{buildLabel}</Badge>
{/if}
