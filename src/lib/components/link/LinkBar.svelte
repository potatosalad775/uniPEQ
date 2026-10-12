<!--
	The modernGraphTool link above the sync bar: "Linked with squig.link", "Waiting for
	modernGraphTool" during mGT's silence, and while joining, the hint to go back to the browser when
	the channel hasn't opened (phone Chrome loses its network 5 s after it leaves the screen). Below
	it, the self-check's one-time tip when Android paused or killed uniPEQ while linked.
-->
<script lang="ts">
	import { BatteryWarning, Link2 } from '@lucide/svelte';
	import Button from '$lib/components/atoms/Button.svelte';
	import { linkStore } from '$lib/link/link-store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { openAppSettings } from '$lib/platform/link';

	const host = $derived(linkStore.host ?? '');
	const text = $derived.by(() => {
		switch (linkStore.state) {
			case 'joining':
				return m.link_row_joining();
			case 'approval':
				return m.link_row_approval({ host });
			case 'waiting':
				return `${m.link_row_linked({ host })} · ${m.link_row_waiting()}`;
			default:
				return m.link_row_linked({ host });
		}
	});
</script>

{#if linkStore.active}
	<!-- The sync bar's height, so the two read as one stack. -->
	<div
		data-link-bar
		class="flex min-h-12 items-center gap-3 border-t border-base-content/10 bg-base-100 px-4 py-1.5 touch:min-h-14"
	>
		<Link2
			class="size-5 shrink-0 {linkStore.state === 'waiting'
				? 'text-base-content/50'
				: 'text-primary'}"
			aria-hidden="true"
		/>
		<p class="min-w-0 flex-1 text-sm leading-snug" role="status">
			{text}
			{#if linkStore.goBack}
				<span class="block text-base-content/70">{m.link_go_back()}</span>
			{/if}
		</p>
	</div>
{/if}
{#if linkStore.batteryTip}
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-base-content/10 bg-base-100 px-4 py-2"
	>
		<BatteryWarning class="size-5 shrink-0 text-warning" aria-hidden="true" />
		<p class="min-w-0 flex-1 basis-48 text-sm leading-snug">{m.link_battery_tip()}</p>
		<div class="ml-auto flex gap-1">
			<Button
				title={m.link_dismiss()}
				size="sm"
				variant="ghost"
				onclick={() => (linkStore.batteryTip = false)}
			>
				{m.link_dismiss()}
			</Button>
			<Button
				title={m.link_battery_settings()}
				size="sm"
				variant="outline"
				onclick={() => {
					linkStore.batteryTip = false;
					openAppSettings();
				}}
			>
				{m.link_battery_settings()}
			</Button>
		</div>
	</div>
{/if}
