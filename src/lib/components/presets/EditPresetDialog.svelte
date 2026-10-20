<!--
	Rename a saved preset and edit its tags. Open while `entry` is set; the parent clears it in
	`onClose` (cancel, Escape, back) and after `onSave`.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import Input from '#lib/components/atoms/Input.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import type { PresetIndexEntry } from '#lib/services/preset-storage.js';
	import * as m from '#lib/paraglide/messages.js';
	import { parseTags } from '#lib/eq/preset-file.js';

	let {
		entry,
		onSave,
		onClose
	}: {
		entry: PresetIndexEntry | null;
		onSave: (id: string, changes: { name: string; tags: string[] }) => void;
		onClose: () => void;
	} = $props();

	let name = $state('');
	let tags = $state('');

	$effect.pre(() => {
		if (!entry) return;
		name = entry.name;
		tags = entry.tags.join(', ');
	});

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!entry || !name.trim()) return;
		onSave(entry.id, { name: name.trim(), tags: parseTags(tags) });
	}
</script>

<ModalDialog
	bind:open={() => entry !== null, (open) => !open && onClose()}
	title={m.presets_edit_title()}
>
	<form id="edit-preset-form" class="flex flex-col gap-3" onsubmit={save}>
		<Input bind:value={name} label={m.presets_name_label()} class="flex-col" />
		<Input
			bind:value={tags}
			label={m.presets_tags_label()}
			placeholder={m.presets_tags_placeholder()}
			class="flex-col"
		/>
	</form>
	{#snippet footer()}
		<Button title={m.device_peq_push_cancel()} variant="ghost" size="sm" onclick={onClose}>
			{m.device_peq_push_cancel()}
		</Button>
		<Button
			title={m.presets_save()}
			size="sm"
			type="submit"
			form="edit-preset-form"
			disabled={!name.trim()}
		>
			{m.presets_save()}
		</Button>
	{/snippet}
</ModalDialog>
