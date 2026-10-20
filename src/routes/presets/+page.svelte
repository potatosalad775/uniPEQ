<script lang="ts">
	import PageBody from '#lib/components/layout/PageBody.svelte';
	import PageHeader from '#lib/components/layout/PageHeader.svelte';
	import PresetsPanel from '#lib/components/presets/PresetsPanel.svelte';
	import * as m from '#lib/paraglide/messages.js';
</script>

<PageHeader title={m.nav_presets()} />
<PageBody class="pb-4 wide:max-w-6xl">
	<PresetsPanel />
</PageBody>
