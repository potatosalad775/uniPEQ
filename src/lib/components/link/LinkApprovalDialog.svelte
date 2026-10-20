<!--
	"Link with <host>?": nothing the link sends touches the device until this is answered. The host
	is mGT's attested origin, never its own claim; the site title it sends is secondary text, and a
	server other than uniPEQ's own is named, since only that one's attestation is trusted. Closing
	it (Android back, the scrim) is "Don't link". Mounted once in the shell: a link can arrive on any
	tab.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import { linkStore, loadLinkService } from '#lib/link/link-store.svelte.js';
	import * as m from '#lib/paraglide/messages.js';

	const approval = $derived(linkStore.approval);
	const host = $derived(approval?.host ?? '');

	function answer(yes: boolean) {
		void loadLinkService().then((service) => (yes ? service.approve() : service.deny()));
	}
</script>

<ModalDialog
	bind:open={() => approval !== null, (open) => !open && approval !== null && answer(false)}
	title={approval?.replaces
		? m.link_replace_title({ current: approval.replaces, host })
		: m.link_approve_title({ host })}
	description={approval?.request.site}
>
	{#if approval?.request.via}
		<p class="text-sm text-base-content/70">
			{m.link_approve_via({ server: approval.request.via })}
		</p>
	{/if}
	<p class="text-sm text-base-content/70">{m.link_approve_text()}</p>
	{#if linkStore.goBack}
		<p class="text-sm text-base-content/70">{m.link_go_back()}</p>
	{/if}
	{#snippet footer()}
		<Button title={m.link_approve_no()} variant="ghost" onclick={() => answer(false)}>
			{m.link_approve_no()}
		</Button>
		<Button title={m.link_approve_yes()} onclick={() => answer(true)}>
			{m.link_approve_yes()}
		</Button>
	{/snippet}
</ModalDialog>
