<!--
	Saved presets: save the EQ, load one into it, import and export files. Plain on purpose: the
	Phase 4 Presets screen adds search, tags, renaming and duplicates (docs/rebuild-plan.md).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import Input from '$lib/components/atoms/Input.svelte';
	import { PresetError } from '$lib/eq/preset-file';
	import * as m from '$lib/paraglide/messages';
	import { saveTextFile } from '$lib/platform/save-file';
	import { logger } from '$lib/services/logger';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import { presetStore } from '$lib/stores/preset-store.svelte';

	let name = $state('');
	let notice = $state<{ text: string; isError: boolean } | null>(null);
	/** The preset whose Delete was pressed once and waits for the second press. */
	let confirmingDelete = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	onMount(() => {
		void presetStore.refresh();
	});

	const say = (text: string, isError = false) => (notice = { text, isError });

	/** Each warning a load or import came with, after its own message. */
	function withWarnings(text: string, w: { disabled: number; skipped?: number }): string {
		const parts = [text];
		if (w.disabled > 0) parts.push(m.presets_disabled_bands({ count: w.disabled }));
		if (w.skipped) parts.push(m.presets_skipped_lines({ count: w.skipped }));
		return parts.join(' ');
	}

	function describeError(e: unknown): string {
		if (e instanceof PresetError) {
			if (e.code === 'not-a-preset') return m.presets_error_not_a_preset();
			if (e.code === 'version') return m.presets_error_version();
			if (e.code === 'empty') return m.presets_error_empty();
			return m.presets_error_invalid({ detail: e.message });
		}
		return m.presets_error_generic();
	}

	async function run(op: string, action: () => Promise<string>) {
		confirmingDelete = null;
		try {
			say(await action());
		} catch (e) {
			logger.error(`preset ${op} failed:`, e instanceof Error ? e.message : String(e));
			say(describeError(e), true);
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
			const how = await saveTextFile(file.name, file.text, file.type);
			return how === 'copied'
				? m.presets_exported_clipboard({ name: file.name })
				: m.presets_exported({ name: file.name });
		});

	function remove(id: string, presetName: string) {
		if (confirmingDelete !== id) {
			confirmingDelete = id;
			return;
		}
		void run('delete', async () => {
			await presetStore.remove(id);
			return m.presets_deleted({ name: presetName });
		});
	}

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

<section aria-labelledby="presets-heading" class="flex flex-col gap-4 rounded-xl bg-base-100 p-4">
	<h2 id="presets-heading" class="sr-only">{m.nav_presets()}</h2>

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
			disabled={!name.trim() || eqStore.filters.length === 0}
		>
			{m.presets_save()}
		</Button>
	</form>

	<div class="flex flex-wrap items-center gap-2">
		<Button title={m.presets_import_title()} variant="outline" onclick={() => fileInput?.click()}>
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

	<p
		class="text-sm {notice?.isError ? 'text-error' : 'text-base-content/70'}"
		role="status"
		aria-live="polite"
	>
		{notice?.text ?? ''}
	</p>

	{#if presetStore.index.length === 0}
		<p class="text-sm text-base-content/70">{m.presets_empty()}</p>
	{:else}
		<ul class="flex flex-col divide-y divide-base-content/10" aria-label={m.presets_list_label()}>
			{#each presetStore.index as entry (entry.id)}
				<li class="flex flex-wrap items-center gap-2 py-2">
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{entry.name}</p>
						<p class="text-xs text-base-content/60">{dateOf(entry.updatedAt)}</p>
					</div>
					<div class="flex shrink-0 gap-1">
						<Button
							title={m.presets_apply_title({ name: entry.name })}
							size="sm"
							onclick={() => apply(entry.id)}
						>
							{m.presets_apply()}
						</Button>
						<Button
							title={m.presets_export_json_title({ name: entry.name })}
							size="sm"
							variant="ghost"
							onclick={() => exportAs(entry.id, 'json')}
						>
							JSON
						</Button>
						<Button
							title={m.presets_export_apo_title({ name: entry.name })}
							size="sm"
							variant="ghost"
							onclick={() => exportAs(entry.id, 'apo')}
						>
							APO
						</Button>
						<Button
							title={confirmingDelete === entry.id
								? m.presets_delete_confirm_title({ name: entry.name })
								: m.presets_delete_title({ name: entry.name })}
							size="sm"
							variant={confirmingDelete === entry.id ? 'destructive' : 'ghost'}
							onclick={() => remove(entry.id, entry.name)}
						>
							{confirmingDelete === entry.id ? m.presets_delete_confirm() : m.presets_delete()}
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
