<!--
	Open-source licenses: uniPEQ's own GPL notice and license text (GPL-3.0 §5(d), "Appropriate Legal
	Notices"), then what the app ships, from `virtual:third-party-licenses`. The texts load on first
	open, and the Android libraries are listed only in the Android app.
-->
<script lang="ts">
	import Accordion from '#lib/components/atoms/Accordion.svelte';
	import AccordionItem from '#lib/components/atoms/AccordionItem.svelte';
	import Sheet from '#lib/components/atoms/Sheet.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { isNative } from '#lib/platform/native.js';
	import type { Notice } from 'virtual:third-party-licenses';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let loaded = $state<{ license: string; notices: Notice[] | null } | null>(null);

	$effect(() => {
		if (open && !loaded) {
			void import('virtual:third-party-licenses').then(({ license, notices }) => {
				loaded = { license, notices: notices?.filter((n) => isNative || !n.android) ?? null };
			});
		}
	});

	const title = (n: Notice) => (n.version ? `${n.name} ${n.version}` : n.name);
</script>

{#snippet licenseText(text: string)}
	<pre
		class="mx-2 mb-2 overflow-x-auto overscroll-x-contain rounded-md bg-base-200 p-2 font-mono text-[11px] whitespace-pre text-base-content/80 select-text">{text}</pre>
{/snippet}

<Sheet bind:open title={m.settings_licenses()}>
	<div class="flex flex-col gap-2 text-sm text-base-content/80">
		<p class="font-medium text-base-content">{m.settings_licenses_copyright()}</p>
		<p>{m.settings_licenses_gpl()}</p>
		<p>
			{m.settings_licenses_source()}
			<a
				href="https://github.com/potatosalad775/uniPEQ"
				target="_blank"
				rel="noopener noreferrer"
				class="text-accent underline">github.com/potatosalad775/uniPEQ</a
			>
		</p>
	</div>

	{#if loaded}
		<Accordion type="single" class="-mx-2 mt-3">
			<AccordionItem value="uniPEQ" title={m.settings_licenses_gpl_title()}>
				{@render licenseText(loaded.license)}
			</AccordionItem>
		</Accordion>

		<h3 class="mt-4 mb-1 text-xs font-semibold tracking-wide text-primary uppercase">
			{m.settings_licenses_third_party()}
		</h3>
		{#if loaded.notices}
			<Accordion type="single" class="-mx-2">
				{#each loaded.notices as notice (`${notice.name}@${notice.version}`)}
					<AccordionItem value={`${notice.name}@${notice.version}`} title={title(notice)}>
						{#if notice.note}
							<p class="mx-2 mb-2 text-xs whitespace-pre-line text-base-content/70">
								{notice.note}
							</p>
						{/if}
						{#if notice.url}
							<!-- External: `resolve()` is for app routes. -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={notice.url}
								target="_blank"
								rel="noopener noreferrer"
								class="mx-2 mb-2 block text-xs break-all text-accent underline">{notice.url}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
						{@render licenseText(notice.text || m.settings_licenses_no_text())}
					</AccordionItem>
				{/each}
			</Accordion>
		{:else}
			<p class="text-sm text-base-content/60">{m.settings_licenses_dev()}</p>
		{/if}
	{/if}
</Sheet>
