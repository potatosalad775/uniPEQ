<!--
	Marks a dev or debug build in each tab's header, so a screenshot or a phone on the desk says
	which one it is. Nothing in a release.
-->
<script lang="ts">
	import { buildLabel } from '$lib/platform/build';
</script>

{#if buildLabel}
	<span
		class="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warning"
		title="{buildLabel} build ({__APP_VERSION__})"
	>
		{buildLabel}
	</span>
{/if}
