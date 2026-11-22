<!--
	Device controls as rows (eqcaps `protocol.controls`), one each in the order given: a toggle is a
	switch, a choice a select menu (as Device EQ is), a range a slider that writes once let go, and
	a range of two or three values a segmented choice. A control is written only when the user
	changes it, and the row shows what the device holds: its value follows the read-back, not the
	press. One that restarts the device asks first; one set so that the EQ doesn't apply says so
	under it, and the sync bar says it too. A gain per channel is one balance slider, in the left
	channel's place. Shared by the device panel (the device's own settings) and the band card (the
	settings of the EQ it edits), which each bring their list and say when it is `disabled`.
-->
<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import type { Control } from '@potatosalad775/eqcaps-core';
	import Button from '#lib/components/atoms/Button.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import SegmentedControl from '#lib/components/atoms/SegmentedControl.svelte';
	import SelectMenu from '#lib/components/atoms/SelectMenu.svelte';
	import Slider from '#lib/components/atoms/Slider.svelte';
	import Switch from '#lib/components/atoms/Switch.svelte';
	import {
		balanceLabel,
		balanceOf,
		balanceValue,
		balanceWrites,
		controlLabel,
		controlValueLabel,
		rangeChoices
	} from '#lib/device-peq/controls.js';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	let {
		controls,
		disabled = false
	}: {
		controls: Control[];
		/** The device would refuse a change now (an EQ's settings while that EQ is off). */
		disabled?: boolean;
	} = $props();

	/** A change that restarts the device, waiting for the user to confirm it. */
	let pending = $state<{ control: Control; value: number } | null>(null);
	/** A slider's value from the drag until the device's read-back replaces it. */
	let held = $state<{ id: string; value: number } | null>(null);

	const values = $derived(devicePeqStore.controlValues);
	const off = $derived(disabled || devicePeqStore.isBusy);
	const balance = $derived(balanceOf(controls));

	const current = (c: Control) => values[c.id] ?? 0;

	async function set(control: Control, value: number) {
		if (value === values[control.id]) return;
		if (control.reconnect) pending = { control, value };
		else await devicePeqService.setControl(control.id, value);
	}

	async function setBalance(n: number) {
		if (balance) await devicePeqService.setControls(balanceWrites(balance, n, values));
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

{#each controls as control (control.id)}
	{@const label = controlLabel(control)}
	{@const choices = rangeChoices(control)}
	{#if balance && control === balance.right}
		<!-- Shown with the left channel's. -->
	{:else if balance && control === balance.left}
		{@const name = m.device_control_balance()}
		{@const shown = held?.id === 'balance' ? held.value : balanceValue(balance, values)}
		<ListRow label={name} {disabled}>
			{#snippet trailing()}
				<span class="tabular-nums">{balanceLabel(balance, shown)}</span>
			{/snippet}
			<Slider
				bind:value={() => shown, (value) => (held = { id: 'balance', value })}
				min={balance.min}
				max={balance.max}
				step={balance.step}
				disabled={off}
				aria-label={name}
				aria-valuetext={balanceLabel(balance, shown)}
				onchange={() => {
					if (held?.id !== 'balance') return;
					void setBalance(held.value).finally(() => (held = null));
				}}
			/>
		</ListRow>
	{:else if control.kind === 'toggle'}
		<ListRow {label} description={hint(control)} for="device-control-{control.id}" disabled={off}>
			{#snippet trailing()}
				<Switch
					id="device-control-{control.id}"
					bind:checked={() => current(control) === 1, (on) => void set(control, on ? 1 : 0)}
					disabled={off}
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
				<ListRow {label} description={hint(control)} disabled={off} buttonProps={props}>
					{#snippet trailing()}
						<span class="max-w-32 truncate">
							{controlValueLabel(control, current(control))}
						</span>
						<ChevronDown class="ml-1 size-4" aria-hidden="true" />
					{/snippet}
				</ListRow>
			{/snippet}
		</SelectMenu>
	{:else if choices}
		<ListRow {label} description={hint(control)} {disabled}>
			{#snippet trailing()}
				<!-- The segment follows what the device holds: a write it refuses leaves it where it was. -->
				<SegmentedControl
					{label}
					bind:value={() => String(current(control)), (next) => void set(control, Number(next))}
					options={choices.map((v) => ({
						value: String(v),
						label: String(v),
						title: controlValueLabel(control, v)
					}))}
					disabled={off}
					class="w-36"
				/>
				<!-- The unit once, after the numbers, as the band rows write theirs: three segments
					with a unit each would leave a phone's row no room for the label. -->
				{#if control.unit === 'dB'}
					<span class="ml-1.5 text-xs text-base-content/60">dB</span>
				{/if}
			{/snippet}
		</ListRow>
	{:else if control.range}
		{@const range = control.range}
		{@const shown = held?.id === control.id ? held.value : current(control)}
		<ListRow {label} description={hint(control)} {disabled}>
			{#snippet trailing()}
				<span class="tabular-nums">{controlValueLabel(control, shown)}</span>
			{/snippet}
			<Slider
				bind:value={() => shown, (value) => (held = { id: control.id, value })}
				min={range.min}
				max={range.max}
				step={'step' in range ? range.step : 'any'}
				disabled={off}
				aria-label={label}
				onchange={() => {
					if (held?.id !== control.id) return;
					void set(control, held.value).finally(() => (held = null));
				}}
			/>
		</ListRow>
	{/if}
{/each}

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
