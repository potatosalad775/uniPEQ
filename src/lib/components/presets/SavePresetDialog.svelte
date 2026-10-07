<!--
	Save the EQ as it is now as a new preset, with a name and optional tags.
-->
<script lang="ts">
	import Button from '$lib/components/atoms/Button.svelte';
	import Input from '$lib/components/atoms/Input.svelte';
	import ModalDialog from '$lib/components/atoms/ModalDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { logger } from '$lib/services/logger';
	import { noticeStore } from '$lib/stores/notice-store.svelte';
	import { parseTags } from '$lib/eq/preset-file';
	import { presetStore } from '$lib/stores/preset-store.svelte';
	import { describePresetError } from './preset-messages';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let name = $state('');
	let tags = $state('');

	$effect(() => {
		if (!open) return;
		name = '';
		tags = '';
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		open = false;
		try {
			const preset = await presetStore.saveCurrent(name.trim(), parseTags(tags));
			noticeStore.say(m.presets_saved({ name: preset.name }));
		} catch (err) {
			logger.error('preset save failed:', err instanceof Error ? err.message : String(err));
			noticeStore.say(describePresetError(err), true);
		}
	}
</script>

<ModalDialog bind:open title={m.presets_save_title()}>
	<form id="save-preset-form" class="flex flex-col gap-3" onsubmit={save}>
		<Input
			bind:value={name}
			label={m.presets_name_label()}
			placeholder={m.presets_save_placeholder()}
			class="flex-col"
		/>
		<Input
			bind:value={tags}
			label={m.presets_tags_label()}
			placeholder={m.presets_tags_placeholder()}
			class="flex-col"
		/>
	</form>
	{#snippet footer()}
		<Button
			title={m.device_peq_push_cancel()}
			variant="ghost"
			size="sm"
			onclick={() => (open = false)}
		>
			{m.device_peq_push_cancel()}
		</Button>
		<Button
			title={m.presets_save_title()}
			size="sm"
			type="submit"
			form="save-preset-form"
			disabled={!name.trim()}
		>
			{m.presets_save()}
		</Button>
	{/snippet}
</ModalDialog>
