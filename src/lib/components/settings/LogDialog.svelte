<!--
	The diagnostics log (the logger's ring buffer): read it, clear it, export it as a text file to
	attach to a bug report. The buffer isn't reactive, so the view takes a copy on open and on
	Refresh.
-->
<script lang="ts">
	import Button from '$lib/components/atoms/Button.svelte';
	import ModalDialog from '$lib/components/atoms/ModalDialog.svelte';
	import * as m from '$lib/paraglide/messages';
	import { saveTextFile } from '$lib/platform/save-file';
	import { logger } from '$lib/services/logger';
	import { noticeStore } from '$lib/stores/notice-store.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let text = $state('');
	let count = $state(0);

	function refresh() {
		text = logger.export();
		count = logger.entries.length;
	}

	$effect(() => {
		if (open) refresh();
	});

	function clear() {
		logger.clear();
		refresh();
	}

	async function exportLog() {
		const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
		const name = `unipeq-log-${stamp}.txt`;
		try {
			const outcome = await saveTextFile(name, logger.export() + '\n', 'text/plain');
			if (outcome !== 'cancelled') noticeStore.say(m.presets_exported({ name }));
		} catch (e) {
			noticeStore.say(m.settings_log_export_failed(), true);
			logger.error('log export failed:', e instanceof Error ? e.message : String(e));
		}
	}
</script>

<ModalDialog bind:open title={m.settings_log_title({ count })} class="max-w-2xl">
	<pre
		class="min-h-32 flex-1 overflow-auto rounded-md bg-base-100 p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-base-content/80 select-text">{text ||
			m.settings_log_empty()}</pre>
	{#snippet footer()}
		<Button title={m.settings_log_clear()} variant="ghost" size="sm" onclick={clear}>
			{m.settings_log_clear()}
		</Button>
		<Button title={m.settings_log_refresh()} variant="ghost" size="sm" onclick={refresh}>
			{m.settings_log_refresh()}
		</Button>
		<Button title={m.settings_log_export_title()} variant="outline" size="sm" onclick={exportLog}>
			{m.settings_log_export()}
		</Button>
		<Button title={m.dialog_close()} size="sm" onclick={() => (open = false)}>
			{m.dialog_close()}
		</Button>
	{/snippet}
</ModalDialog>
