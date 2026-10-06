<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<PageHeader title={m.nav_main()} />
<div class="px-4 pb-4">
	<p class="rounded-xl bg-base-100 p-6 text-sm text-base-content/70">{m.main_placeholder()}</p>
</div>
