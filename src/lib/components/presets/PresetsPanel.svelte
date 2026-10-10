<!--
	Saved presets: save the EQ, search, load one into it, rename and tag, duplicate, import and
	export files, delete. With a device connected, each preset says how it fits the device (the
	prototype's compatibility badge, now from eqcaps' `fit`). Phase 4.5 (decision 22): a one-line
	save, and touch-height rows.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, EllipsisVertical, FileUp, Search, SquarePen, Trash } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import Input from '$lib/components/atoms/Input.svelte';
	import Menu from '$lib/components/atoms/Menu.svelte';
	import MenuItem from '$lib/components/atoms/MenuItem.svelte';
	import MenuSeparator from '$lib/components/atoms/MenuSeparator.svelte';
	import type { PresetFit } from '$lib/device-peq/preset-fit';
	import * as m from '$lib/paraglide/messages';
	import { saveTextFile } from '$lib/platform/save-file';
	import type { PresetIndexEntry } from '$lib/services/preset-storage';
	import { logger } from '$lib/services/logger';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import { searchPresets } from '$lib/services/preset-storage';
	import { presetStore } from '$lib/stores/preset-store.svelte';
	import EditPresetDialog from './EditPresetDialog.svelte';
	import { describePresetError, FIT_TONE_CLASS, fitBadge, withWarnings } from './preset-messages';

	let name = $state('');
	let query = $state('');
	let notice = $state<{ text: string; isError: boolean } | null>(null);
	/** The preset whose Delete was picked and waits for the confirming press. */
	let confirmingDelete = $state<string | null>(null);
	let editing = $state<PresetIndexEntry | null>(null);
	let fits = $state.raw<Record<string, PresetFit>>({});
	let fileInput: HTMLInputElement | undefined = $state();

	const shown = $derived(searchPresets(presetStore.index, query));

	onMount(() => {
		void presetStore.refresh();
	});

	$effect(() => {
		const profile = devicePeqStore.profile;
		const caps = devicePeqStore.capabilities;
		void presetStore.index;
		if (!profile || !caps) {
			fits = {};
			return;
		}
		let stale = false;
		void presetStore.fits(profile, caps).then((next) => {
			if (!stale) fits = next;
		});
		return () => (stale = true);
	});

	const say = (text: string, isError = false) => (notice = { text, isError });

	async function run(op: string, action: () => Promise<string | null>) {
		confirmingDelete = null;
		try {
			const text = await action();
			if (text) say(text);
		} catch (e) {
			logger.error(`preset ${op} failed:`, e instanceof Error ? e.message : String(e));
			say(describePresetError(e), true);
		}
	}

	const save = () =>
		run('save', async () => {
			const preset = await presetStore.saveCurrent(name.trim());
			name = '';
			return m.presets_saved({ name: preset.name });
		});

	const apply = (id: string) =>
		run('load', async () => {
			const parsed = await presetStore.apply(id);
			return withWarnings(m.presets_loaded({ name: parsed.preset.name }), parsed);
		});

	const exportAs = (id: string, format: 'json' | 'apo') =>
		run('export', async () => {
			const file = await presetStore.exportFile(id, format);
			const outcome = await saveTextFile(file.name, file.text, file.type);
			if (outcome === 'cancelled') return null;
			return outcome === 'shared'
				? m.presets_exported_shared({ name: file.name })
				: m.presets_exported({ name: file.name });
		});

	const duplicate = (entry: PresetIndexEntry) =>
		run('duplicate', async () => {
			const copy = await presetStore.duplicate(entry.id, m.presets_copy_name({ name: entry.name }));
			return m.presets_duplicated({ name: copy.name });
		});

	function saveEdit(id: string, changes: { name: string; tags: string[] }) {
		editing = null;
		void run('edit', async () => {
			const preset = await presetStore.edit(id, changes);
			return m.presets_edited({ name: preset.name });
		});
	}

	const remove = (entry: PresetIndexEntry) =>
		run('delete', async () => {
			await presetStore.remove(entry.id);
			return m.presets_deleted({ name: entry.name });
		});

	async function importFile(e: Event & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await run('import', async () => {
			const imported = await presetStore.importText(await file.text(), file.name);
			return withWarnings(m.presets_imported({ name: imported.preset.name }), imported);
		});
	}

	const dateOf = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<div class="flex flex-col gap-4 wide:flex-row">
	<section aria-labelledby="save-heading" class="h-fit rounded-xl bg-base-100 p-4 wide:flex-1">
		<h2 id="save-heading" class="sr-only">{m.presets_save_title()}</h2>
		<!-- One line: name and Save. Tags are set in Edit, or in the EQ tab's save dialog. -->
		<form
			class="flex items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<Input
				bind:value={name}
				label={m.presets_save_label()}
				placeholder={m.presets_save_placeholder()}
				class="flex-col"
			/>
			<Button
				title={m.presets_save_title()}
				type="submit"
				class="shrink-0"
				disabled={!name.trim() || eqStore.filters.length === 0}
			>
				{m.presets_save()}
			</Button>
		</form>
	</section>

	<section
		aria-labelledby="presets-heading"
		class="flex flex-col gap-3 rounded-xl bg-base-100 p-4 wide:flex-2"
	>
		<div class="flex items-center gap-2">
			<h2 id="presets-heading" class="sr-only">{m.presets_list_label()}</h2>
			<Input
				bind:value={query}
				type="search"
				placeholder={m.presets_search_placeholder()}
				aria-label={m.presets_search_placeholder()}
			>
				{#snippet icon()}<Search class="size-4 text-base-content/50" />{/snippet}
			</Input>
			<Button
				title={m.presets_import_title()}
				variant="outline"
				class="shrink-0 gap-1.5"
				onclick={() => fileInput?.click()}
			>
				<FileUp class="size-4" aria-hidden="true" />
				{m.presets_import()}
			</Button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".json,.txt,application/json,text/plain"
				class="hidden"
				onchange={importFile}
			/>
		</div>

		{#if notice?.text != undefined && notice?.text.length > 0}
			<p
				class="text-sm {notice?.isError ? 'text-error' : 'text-base-content/70'}"
				role="status"
				aria-live="polite"
			>
				{notice?.text ?? ''}
			</p>
		{/if}

		{#if presetStore.index.length === 0}
			<p class="text-sm text-base-content/70">{m.presets_empty()}</p>
		{:else if shown.length === 0}
			<p class="text-sm text-base-content/70">{m.presets_no_match()}</p>
		{:else}
			<ul
				class="-mt-2 -mb-3 flex flex-col divide-y divide-base-content/10"
				aria-label={m.presets_list_label()}
			>
				{#each shown as entry (entry.id)}
					{@const fit = fits[entry.id]}
					<li class="flex min-h-14 flex-wrap items-center gap-2 py-3 touch:min-h-16">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium touch:text-base">{entry.name}</p>
							<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
								<span>{dateOf(entry.updatedAt)}</span>
								{#each entry.tags as tag (tag)}
									<span class="rounded bg-base-300 px-1.5 py-0.5 text-[11px] text-base-content/80"
										>{tag}</span
									>
								{/each}
								{#if fit}
									{@const badge = fitBadge(fit)}
									<span class="rounded-full px-2 py-0.5 text-[11px] {FIT_TONE_CLASS[badge.tone]}">
										{badge.text}
									</span>
								{/if}
							</p>
						</div>
						<div class="-mr-2.5 flex shrink-0 items-center gap-1">
							{#if confirmingDelete === entry.id}
								<Button
									title={m.presets_delete_confirm_title({ name: entry.name })}
									size="sm"
									variant="destructive"
									onclick={() => remove(entry)}
								>
									{m.presets_delete_confirm()}
								</Button>
								<Button
									title={m.device_peq_push_cancel()}
									size="sm"
									variant="ghost"
									onclick={() => (confirmingDelete = null)}
								>
									{m.device_peq_push_cancel()}
								</Button>
							{:else}
								<Button
									title={eqConstraintStore.editable
										? m.presets_apply_title({ name: entry.name })
										: m.presets_apply_needs_device()}
									size="sm"
									disabled={!eqConstraintStore.editable}
									onclick={() => apply(entry.id)}
								>
									{m.presets_apply()}
								</Button>
								<Menu class="min-w-44">
									{#snippet trigger(props)}
										<Button
											{...props}
											title={m.presets_more({ name: entry.name })}
											size="icon-sm"
											variant="ghost"
										>
											<EllipsisVertical class="size-4" aria-hidden="true" />
										</Button>
									{/snippet}
									<MenuItem onSelect={() => (editing = entry)}>
										{#snippet icon()}<SquarePen class="size-4" aria-hidden="true" />{/snippet}
										{m.presets_edit()}
									</MenuItem>
									<MenuItem onSelect={() => duplicate(entry)}>
										{#snippet icon()}<Copy class="size-4" aria-hidden="true" />{/snippet}
										{m.presets_duplicate()}
									</MenuItem>
									<MenuSeparator />
									<MenuItem onSelect={() => exportAs(entry.id, 'json')}>
										{m.presets_export_json()}
									</MenuItem>
									<MenuItem onSelect={() => exportAs(entry.id, 'apo')}>
										{m.presets_export_apo()}
									</MenuItem>
									<MenuSeparator />
									<MenuItem destructive onSelect={() => (confirmingDelete = entry.id)}>
										{#snippet icon()}<Trash class="size-4" aria-hidden="true" />{/snippet}
										{m.presets_delete()}
									</MenuItem>
								</Menu>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<EditPresetDialog entry={editing} onSave={saveEdit} onClose={() => (editing = null)} />
