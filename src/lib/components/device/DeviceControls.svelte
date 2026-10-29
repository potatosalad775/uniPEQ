<!--
	The device's settings besides the EQ (eqcaps `protocol.controls`): volume, gain, DAC filter, USB
	mode and the like, one row each in the profile's order, only those the device has now. A toggle is
	a switch, a choice a select menu (as Device EQ is), a range a slider that writes once let go: a
	control is written only when the user changes it. One that restarts the device asks first; one
	set so that the EQ doesn't apply says so under it, and the sync bar says it too.
-->
<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import type { Control } from '@potatosalad775/eqcaps-core';
	import Button from '#lib/components/atoms/Button.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import SelectMenu from '#lib/components/atoms/SelectMenu.svelte';
	import Slider from '#lib/components/atoms/Slider.svelte';
	import Switch from '#lib/components/atoms/Switch.svelte';
	import { controlLabel, controlValueLabel } from '#lib/device-peq/controls.js';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	const headingId = $props.id();

	/** A change that restarts the device, waiting for the user to confirm it. */
	let pending = $state<{ control: Control; value: number } | null>(null);
	/** A slider's value from the drag until the device's read-back replaces it. */
	let held = $state<{ id: string; value: number } | null>(null);

	const values = $derived(devicePeqStore.controlValues);
	const busy = $derived(devicePeqStore.isBusy);

	const current = (c: Control) => values[c.id] ?? 0;

	async function set(control: Control, value: number) {
		if (value === values[control.id]) return;
		if (control.reconnect) pending = { control, value };
		else await devicePeqService.setControl(control.id, value);
	}

	function hint(control: Control): string | undefined {
		if (devicePeqStore.eqOffBy.includes(control)) return m.device_control_eq_off_hint();
		if (control.reconnect) return m.device_control_restart_hint();
		return undefined;
	}

	function confirm() {
		const change = pending;
		pending = null;
		if (change) void devicePeqService.setControl(change.control.id, change.value);
	}
</script>

{#if devicePeqStore.controls.length > 0}
	<section aria-labelledby={headingId} class="flex flex-col gap-1">
		<h3 id={headingId} class="text-xs font-semibold tracking-wide text-primary uppercase">
			{m.device_control_section()}
		</h3>
		<div class="-mx-4 flex flex-col divide-y divide-base-content/10">
			{#each devicePeqStore.controls as control (control.id)}
				{@const label = controlLabel(control)}
				{#if control.kind === 'toggle'}
					<ListRow
						{label}
						description={hint(control)}
						for="device-control-{control.id}"
						disabled={busy}
					>
						{#snippet trailing()}
							<Switch
								id="device-control-{control.id}"
								bind:checked={() => current(control) === 1, (on) => void set(control, on ? 1 : 0)}
								disabled={busy}
							/>
						{/snippet}
					</ListRow>
				{:else if control.kind === 'choice'}
					<SelectMenu
						{label}
						value={String(current(control))}
						options={(control.values ?? []).map((v) => ({ value: String(v.value), label: v.name }))}
						onValueChange={(next) => void set(control, Number(next))}
					>
						{#snippet trigger(props)}
							<ListRow {label} description={hint(control)} disabled={busy} buttonProps={props}>
								{#snippet trailing()}
									<span class="max-w-32 truncate">
										{controlValueLabel(control, current(control))}
									</span>
									<ChevronDown class="ml-1 size-4" aria-hidden="true" />
								{/snippet}
							</ListRow>
						{/snippet}
					</SelectMenu>
				{:else if control.range}
					{@const range = control.range}
					{@const shown = held?.id === control.id ? held.value : current(control)}
					<ListRow {label} description={hint(control)}>
						{#snippet trailing()}
							<span class="tabular-nums">{controlValueLabel(control, shown)}</span>
						{/snippet}
						<Slider
							bind:value={() => shown, (value) => (held = { id: control.id, value })}
							min={range.min}
							max={range.max}
							step={'step' in range ? range.step : 'any'}
							disabled={busy}
							aria-label={label}
							onchange={() => {
								if (held?.id !== control.id) return;
								void set(control, held.value).finally(() => (held = null));
							}}
						/>
					</ListRow>
				{/if}
			{/each}
		</div>
	</section>
{/if}

<ModalDialog
	bind:open={
		() => pending !== null,
		(open) => {
			if (!open) pending = null;
		}
	}
	title={pending ? m.device_control_confirm_title({ control: controlLabel(pending.control) }) : ''}
	description={m.device_control_confirm_body()}
>
	{#snippet footer()}
		<Button title={m.device_peq_push_cancel()} variant="ghost" onclick={() => (pending = null)}>
			{m.device_peq_push_cancel()}
		</Button>
		<Button title={m.device_control_confirm()} onclick={confirm}>
			{m.device_control_confirm()}
		</Button>
	{/snippet}
</ModalDialog>
