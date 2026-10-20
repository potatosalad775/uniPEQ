<!--
	Link with modernGraphTool by its code: one field that takes the code mGT shows (`ABCD-1234`,
	look-alike letters forgiven) or a pasted link. A typed code joins uniPEQ's own server; a link
	names its server. Works on the web too, e.g. from a second desktop browser.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import Input from '#lib/components/atoms/Input.svelte';
	import Sheet from '#lib/components/atoms/Sheet.svelte';
	import { loadLinkService } from '#lib/link/link-store.svelte.js';
	import * as m from '#lib/paraglide/messages.js';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let code = $state('');
	let invalid = $state(false);

	$effect(() => {
		if (!open) return;
		code = '';
		invalid = false;
	});

	async function join(e: SubmitEvent) {
		e.preventDefault();
		const service = await loadLinkService();
		if (!service.open(code)) {
			invalid = true;
			return;
		}
		open = false;
	}
</script>

<Sheet bind:open title={m.link_menu()}>
	<form class="flex flex-col gap-3" onsubmit={join}>
		<p class="text-sm text-base-content/70">{m.link_sheet_text()}</p>
		<Input
			bind:value={code}
			aria-label={m.link_sheet_label()}
			aria-invalid={invalid}
			aria-describedby={invalid ? 'link-code-error' : undefined}
			placeholder="ABCD-1234"
			autocomplete="off"
			autocapitalize="characters"
			spellcheck={false}
			oninput={() => (invalid = false)}
		/>
		{#if invalid}
			<p id="link-code-error" class="text-sm text-error">{m.link_sheet_invalid()}</p>
		{/if}
		<div class="flex justify-end">
			<Button title={m.link_sheet_join()} type="submit" disabled={!code.trim()}>
				{m.link_sheet_join()}
			</Button>
		</div>
	</form>
</Sheet>
