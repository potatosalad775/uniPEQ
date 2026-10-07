<!--
	The EQ tab's app bar (decision 22), replacing the page title and the old toolbar: the device
	chip (phone; `wide:` shows the device panel instead), undo and redo (also Ctrl+Z,
	Ctrl+Shift+Z / Ctrl+Y outside text boxes), and an overflow menu with Load preset, Save preset
	and Fit.
-->
<script lang="ts">
	import { EllipsisVertical, FolderOpen, Redo2, Save, Undo2, Wand2 } from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import Button from '$lib/components/atoms/Button.svelte';
	import DeviceChip from '$lib/components/device/DeviceChip.svelte';
	import PresetPickerDialog from '$lib/components/presets/PresetPickerDialog.svelte';
	import SavePresetDialog from '$lib/components/presets/SavePresetDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onBack } from '$lib/platform/back-button';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	let { onDevice }: { /** Open the device sheet (phone). */ onDevice: () => void } = $props();

	let pickerOpen = $state(false);
	let saveOpen = $state(false);
	let menuOpen = $state(false);

	$effect(() => {
		if (!menuOpen) return;
		return onBack(() => {
			menuOpen = false;
			return true;
		});
	});

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

	const item =
		'flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-base-content/10 touch:min-h-12 touch:text-base';
</script>

<svelte:window {onkeydown} />

<header class="flex min-h-14 items-center gap-1 px-4" role="toolbar" aria-label={m.eq_toolbar()}>
	<h1 class="sr-only">{m.nav_main()}</h1>
	<div class="min-w-0 flex-1 wide:hidden">
		<DeviceChip onclick={onDevice} />
	</div>
	<p class="hidden flex-1 text-lg font-semibold wide:block" aria-hidden="true">{m.nav_main()}</p>
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
	<DropdownMenu.Root bind:open={menuOpen}>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} title={m.eq_more()} size="icon" variant="ghost">
					<EllipsisVertical class="size-4" aria-hidden="true" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				align="end"
				sideOffset={4}
				class="z-50 min-w-52 rounded-xl border border-base-content/10 bg-base-100 p-1 shadow-xl"
			>
				<DropdownMenu.Item class={item} onSelect={() => (pickerOpen = true)}>
					<FolderOpen class="size-4" aria-hidden="true" />
					{m.eq_load_preset()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					class={item}
					disabled={eqStore.filters.length === 0}
					onSelect={() => (saveOpen = true)}
				>
					<Save class="size-4" aria-hidden="true" />
					{m.eq_save_preset()}
				</DropdownMenu.Item>
				{#if devicePeqStore.isConnected}
					<DropdownMenu.Separator class="my-1 h-px bg-base-content/10" />
					<DropdownMenu.Item class={item} disabled={!eqConstraintStore.fitted} onSelect={fit}>
						<Wand2 class="size-4" aria-hidden="true" />
						<span class="flex flex-col">
							{m.eq_fit()}
							<span class="text-xs text-base-content/60">{m.eq_fit_title()}</span>
						</span>
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>
</header>

<PresetPickerDialog bind:open={pickerOpen} />
<SavePresetDialog bind:open={saveOpen} />
