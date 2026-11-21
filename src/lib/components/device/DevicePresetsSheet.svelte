<!--
	The device's own presets, for a device that edits them (`devicePeqStore.canEditPresets`), in
	place of Device EQ's menu: how many of its places are used, a row for each of the menu's choices
	in its order (a tap does what picking it there did, and closes the sheet), a ⋮ on each preset
	with Rename and Delete for that preset, and New preset last. Rename and Delete ask in a dialog
	over the sheet, which stays open. Their results go to the sync bar, as every device operation's
	do.
-->
<script lang="ts">
	import { Check, EllipsisVertical, Plus, SquarePen, Trash2 } from '@lucide/svelte';
	import type { Slot } from '@potatosalad775/eqcaps-device-bridge';
	import Button from '#lib/components/atoms/Button.svelte';
	import Input from '#lib/components/atoms/Input.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import Menu from '#lib/components/atoms/Menu.svelte';
	import MenuItem from '#lib/components/atoms/MenuItem.svelte';
	import MenuSeparator from '#lib/components/atoms/MenuSeparator.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import Sheet from '#lib/components/atoms/Sheet.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	let {
		open = $bindable(false),
		choices,
		value
	}: {
		open?: boolean;
		/** Device EQ's choices, in its order; `preset` is set on the device's own presets. */
		choices: readonly { value: string; label: string; preset?: Slot }[];
		/** The choice the device is on. */
		value: string;
	} = $props();

	const busy = $derived(devicePeqStore.isBusy);
	const room = $derived(devicePeqStore.slotRoom);
	const count = $derived(devicePeqStore.slots.length);
	const full = $derived(room !== null && count >= room);

	/** The preset whose Rename or Delete was picked, while its dialog is open. */
	let renaming = $state<Slot | null>(null);
	let deleting = $state<Slot | null>(null);
	let newName = $state('');
	/** The device refused the name just tried: said in the dialog, which stays open. */
	let renameRefused = $state(false);

	// Nothing here reaches the device once its list or the connection is gone.
	$effect(() => {
		if (devicePeqStore.canEditPresets && devicePeqStore.canEdit) return;
		open = false;
		renaming = null;
		deleting = null;
	});

	function pick(next: string) {
		open = false;
		if (next !== value) void devicePeqService.switchTo(next);
	}

	function startRename(preset: Slot) {
		newName = preset.name;
		renameRefused = false;
		renaming = preset;
	}

	async function rename() {
		if (!renaming) return;
		renameRefused = !(await devicePeqService.renamePreset(renaming.id, newName));
		if (!renameRefused) renaming = null;
	}

	function remove() {
		if (!deleting) return;
		const { id } = deleting;
		deleting = null;
		void devicePeqService.deletePreset(id);
	}
</script>

<Sheet bind:open title={m.device_peq_presets_manage()}>
	{#if room !== null}
		<p class="pb-2 text-sm text-base-content/70">
			{m.device_peq_presets_count({ count, max: room })}
		</p>
	{/if}
	<ul class="-mx-4 flex flex-col divide-y divide-base-content/10">
		{#each choices as choice (choice.value)}
			{@const current = choice.value === value}
			<li
				class="relative flex items-center pr-2 has-[[data-row]:enabled:active]:bg-base-content/10 **:data-row:bg-transparent **:data-row:after:absolute **:data-row:after:inset-0 [@media(hover:hover)]:has-[[data-row]:enabled:hover]:bg-base-content/5"
			>
				<ListRow
					class="min-w-0 flex-1"
					label={choice.label}
					disabled={busy}
					onclick={() => pick(choice.value)}
					buttonProps={{ 'aria-current': current || undefined, 'data-row': '' }}
				>
					{#snippet leading()}
						<Check class="size-4 text-primary {current ? '' : 'invisible'}" aria-hidden="true" />
					{/snippet}
				</ListRow>
				{#if choice.preset}
					{@const preset = choice.preset}
					<Menu class="min-w-52">
						{#snippet trigger(props)}
							<Button
								{...props}
								title={m.presets_more({ name: preset.name })}
								size="icon-sm"
								variant="ghost"
								class="relative not-hover:bg-transparent"
								disabled={busy}
							>
								<EllipsisVertical class="size-4" aria-hidden="true" />
							</Button>
						{/snippet}
						<MenuItem onSelect={() => startRename(preset)}>
							{#snippet icon()}<SquarePen class="size-4" aria-hidden="true" />{/snippet}
							{m.device_peq_presets_rename({ name: preset.name })}
						</MenuItem>
						<MenuSeparator />
						<MenuItem destructive disabled={count <= 1} onSelect={() => (deleting = preset)}>
							{#snippet icon()}<Trash2 class="size-4" aria-hidden="true" />{/snippet}
							{m.device_peq_presets_delete({ name: preset.name })}
						</MenuItem>
					</Menu>
				{/if}
			</li>
		{/each}
		<li>
			<ListRow
				label={m.device_peq_presets_new()}
				description={full ? m.device_peq_presets_full() : undefined}
				disabled={busy || full}
				onclick={() => void devicePeqService.createPreset()}
			>
				{#snippet leading()}<Plus class="size-4" aria-hidden="true" />{/snippet}
			</ListRow>
		</li>
	</ul>
</Sheet>

<ModalDialog
	bind:open={
		() => renaming !== null,
		(next) => {
			if (!next) renaming = null;
		}
	}
	title={m.device_peq_presets_rename_title()}
	description={m.device_peq_presets_rename_body()}
>
	<form
		id="device-preset-rename"
		onsubmit={(event) => {
			event.preventDefault();
			void rename();
		}}
	>
		<Input bind:value={newName} aria-label={m.presets_name_label()} autocomplete="off" />
	</form>
	{#if renameRefused && devicePeqStore.statusIsError}
		<p class="text-sm text-error" role="alert">{devicePeqStore.statusMessage}</p>
	{/if}
	{#snippet footer()}
		<Button title={m.device_peq_presets_cancel()} variant="ghost" onclick={() => (renaming = null)}>
			{m.device_peq_presets_cancel()}
		</Button>
		<Button
			title={m.device_peq_presets_rename_confirm()}
			type="submit"
			form="device-preset-rename"
			disabled={!newName.trim() || busy}
		>
			{m.device_peq_presets_rename_confirm()}
		</Button>
	{/snippet}
</ModalDialog>

<ModalDialog
	bind:open={
		() => deleting !== null,
		(next) => {
			if (!next) deleting = null;
		}
	}
	title={m.device_peq_presets_delete_title({ name: deleting?.name ?? '' })}
	description={m.device_peq_presets_delete_body({ device: devicePeqStore.deviceName ?? '' })}
>
	{#snippet footer()}
		<Button title={m.device_peq_presets_cancel()} variant="ghost" onclick={() => (deleting = null)}>
			{m.device_peq_presets_cancel()}
		</Button>
		<Button title={m.device_peq_presets_delete_confirm()} variant="destructive" onclick={remove}>
			{m.device_peq_presets_delete_confirm()}
		</Button>
	{/snippet}
</ModalDialog>
