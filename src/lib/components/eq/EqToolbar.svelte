<!--
	Actions on the whole EQ: undo and redo (also Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y outside text boxes),
	Fit to the device, and loading or saving a preset.
-->
<script lang="ts">
	import { FolderOpen, Redo2, Save, Undo2, Wand2 } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import PresetPickerDialog from '$lib/components/presets/PresetPickerDialog.svelte';
	import SavePresetDialog from '$lib/components/presets/SavePresetDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	let pickerOpen = $state(false);
	let saveOpen = $state(false);

	function fit() {
		const next = eqConstraintStore.fitted;
		if (next) eqStore.replace(next);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) eqStore.undo();
		else if ((key === 'z' && e.shiftKey) || key === 'y') eqStore.redo();
		else return;
		e.preventDefault();
	}
</script>

<svelte:window {onkeydown} />

<div class="flex flex-wrap items-center gap-1" role="toolbar" aria-label={m.eq_toolbar()}>
	<Button
		title={m.eq_undo()}
		size="icon"
		variant="ghost"
		disabled={!eqStore.canUndo}
		onclick={() => eqStore.undo()}
	>
		<Undo2 class="size-4" aria-hidden="true" />
	</Button>
	<Button
		title={m.eq_redo()}
		size="icon"
		variant="ghost"
		disabled={!eqStore.canRedo}
		onclick={() => eqStore.redo()}
	>
		<Redo2 class="size-4" aria-hidden="true" />
	</Button>
	{#if devicePeqStore.isConnected}
		<Button
			title={m.eq_fit_title()}
			size="sm"
			variant="ghost"
			class="gap-1.5"
			disabled={!eqConstraintStore.fitted}
			onclick={fit}
		>
			<Wand2 class="size-4" aria-hidden="true" />
			{m.eq_fit()}
		</Button>
	{/if}
	<span class="flex-1"></span>
	<Button
		title={m.eq_load_preset_title()}
		size="sm"
		variant="ghost"
		class="gap-1.5"
		onclick={() => (pickerOpen = true)}
	>
		<FolderOpen class="size-4" aria-hidden="true" />
		{m.eq_load_preset()}
	</Button>
	<Button
		title={m.presets_save_title()}
		size="sm"
		variant="ghost"
		class="gap-1.5"
		disabled={eqStore.filters.length === 0}
		onclick={() => (saveOpen = true)}
	>
		<Save class="size-4" aria-hidden="true" />
		{m.eq_save_preset()}
	</Button>
</div>

<PresetPickerDialog bind:open={pickerOpen} />
<SavePresetDialog bind:open={saveOpen} />
