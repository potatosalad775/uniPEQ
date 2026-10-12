<!--
	The EQ tab's app bar, replacing the page title and the old toolbar: the device
	chip (phone; `wide:` shows the device panel instead), undo and redo (also Ctrl+Z,
	Ctrl+Shift+Z / Ctrl+Y outside text boxes), and an overflow menu with Load preset, Save preset,
	Fit, and Link with modernGraphTool (Unlink while linked, with the link's state under it). A dot
	on ⋮ says a link is on, pulsing while it connects, dim while modernGraphTool is quiet.
-->
<script lang="ts">
	import {
		EllipsisVertical,
		FolderOpen,
		Link2,
		Redo2,
		Save,
		Undo2,
		Unlink2,
		WandSparkles
	} from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import Menu from '$lib/components/atoms/Menu.svelte';
	import MenuItem from '$lib/components/atoms/MenuItem.svelte';
	import MenuSeparator from '$lib/components/atoms/MenuSeparator.svelte';
	import DeviceChip from '$lib/components/device/DeviceChip.svelte';
	import BuildBadge from '$lib/components/layout/BuildBadge.svelte';
	import LinkSheet from '$lib/components/link/LinkSheet.svelte';
	import PresetPickerDialog from '$lib/components/presets/PresetPickerDialog.svelte';
	import SavePresetDialog from '$lib/components/presets/SavePresetDialog.svelte';
	import { linkLabel } from '$lib/link/link-status';
	import { linkStore, loadLinkService } from '$lib/link/link-store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';

	let {
		onDevice
	}: { /** The chip's press: connect, or open the device sheet (phone). */ onDevice: () => void } =
		$props();

	let pickerOpen = $state(false);
	let saveOpen = $state(false);
	let linkOpen = $state(false);

	const linkState = $derived(linkLabel(linkStore.state, linkStore.host));
	const linkDot = $derived(
		linkStore.state === 'linked'
			? 'bg-primary'
			: linkStore.state === 'waiting'
				? 'bg-base-content/40'
				: 'animate-pulse bg-primary'
	);

	function fit() {
		const next = eqConstraintStore.fitted;
		if (next) eqStore.replace(next);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || e.altKey || !eqConstraintStore.editable) return;
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

<header
	class="flex min-h-14 items-center gap-1 pr-1 pl-4 wide:max-w-6xl"
	role="toolbar"
	aria-label={m.eq_toolbar()}
>
	<h1 class="sr-only">UniPEQ</h1>
	<div class="-ml-2 min-w-0 flex-1 wide:hidden">
		<DeviceChip onclick={onDevice} />
	</div>
	<p class="hidden flex-1 text-lg font-semibold wide:block" aria-hidden="true">UniPEQ</p>
	<BuildBadge />
	<Button
		title={m.eq_undo()}
		size="icon-sm"
		variant="ghost"
		class="p-2"
		disabled={!eqConstraintStore.editable || !eqStore.canUndo}
		onclick={() => eqStore.undo()}
	>
		<Undo2 class="-mt-0.5 size-5" aria-hidden="true" />
	</Button>
	<Button
		title={m.eq_redo()}
		size="icon-sm"
		variant="ghost"
		class="p-2"
		disabled={!eqConstraintStore.editable || !eqStore.canRedo}
		onclick={() => eqStore.redo()}
	>
		<Redo2 class="-mt-0.5 size-5" aria-hidden="true" />
	</Button>
	<Menu>
		{#snippet trigger(props)}
			<Button
				{...props}
				title={linkStore.active && linkState ? `${m.eq_more()} · ${linkState}` : m.eq_more()}
				size="icon-sm"
				class="relative p-2"
				variant="ghost"
			>
				<EllipsisVertical class="size-5" aria-hidden="true" />
				{#if linkStore.active}
					<span
						class="absolute top-1 right-1 size-2.5 rounded-full ring-2 ring-base-100 {linkDot}"
						aria-hidden="true"
					></span>
				{/if}
			</Button>
		{/snippet}
		<MenuItem disabled={!eqConstraintStore.editable} onSelect={() => (pickerOpen = true)}>
			{#snippet icon()}<FolderOpen class="size-4" aria-hidden="true" />{/snippet}
			{m.eq_load_preset()}
		</MenuItem>
		<MenuItem disabled={eqStore.filters.length === 0} onSelect={() => (saveOpen = true)}>
			{#snippet icon()}<Save class="size-4" aria-hidden="true" />{/snippet}
			{m.eq_save_preset()}
		</MenuItem>
		{#if eqConstraintStore.editable}
			<MenuSeparator />
			<MenuItem disabled={!eqConstraintStore.fitted} description={m.eq_fit_title()} onSelect={fit}>
				{#snippet icon()}<WandSparkles class="size-4" aria-hidden="true" />{/snippet}
				{m.eq_fit()}
			</MenuItem>
		{/if}
		<MenuSeparator />
		{#if linkStore.active}
			<MenuItem
				description={linkState ?? undefined}
				onSelect={() => void loadLinkService().then((service) => service.unlink())}
			>
				{#snippet icon()}<Unlink2 class="size-4" aria-hidden="true" />{/snippet}
				{m.link_unlink()}
			</MenuItem>
		{:else}
			<MenuItem onSelect={() => (linkOpen = true)}>
				{#snippet icon()}<Link2 class="size-4" aria-hidden="true" />{/snippet}
				{m.link_menu()}
			</MenuItem>
		{/if}
	</Menu>
</header>

<PresetPickerDialog bind:open={pickerOpen} />
<SavePresetDialog bind:open={saveOpen} />
<LinkSheet bind:open={linkOpen} />
