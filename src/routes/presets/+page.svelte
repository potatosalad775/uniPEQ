<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PresetsPanel from '$lib/components/presets/PresetsPanel.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<PageHeader title={m.nav_presets()} />
<div class="px-4 pb-4 wide:max-w-6xl">
	<PresetsPanel />
</div>
