<!--
	Which of the device's EQs the band card edits, for a device that has several (a Qudelix 5K's
	user EQ and its headphone EQ): a segment for each, named by the data. The first row of the band
	card, above the channels, since the channels, the preamp and the bands are that EQ's. Shown only
	while a device with more than one EQ is connected; held while a device operation runs. An EQ the
	device's current mode lacks can't be picked, and the row says so. Picking another EQ while the
	list holds changes the one on screen never got asks first: write them to it, discard them, or
	stay.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import SegmentedControl from '#lib/components/atoms/SegmentedControl.svelte';
	import { eqLabel } from '#lib/device-peq/device-eqs.js';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	const eqs = $derived(devicePeqStore.eqs);
	// Keyed by position: the profile's own EQ has no id.
	const options = $derived(
		eqs.map((eq, i) => ({
			value: String(i),
			label: eqLabel(eq),
			title: m.eq_target_title({ eq: eqLabel(eq) }),
			disabled: !eq.present
		}))
	);
	const selected = $derived(String(eqs.findIndex((eq) => eq.id === devicePeqStore.eq)));
	const absent = $derived(
		eqs
			.filter((eq) => !eq.present)
			.map(eqLabel)
			.join(', ')
	);
	const named = (id: string | undefined) => eqLabel(eqs.find((eq) => eq.id === id) ?? {});
	const leaving = $derived(devicePeqService.eqLeaving);
</script>

{#if eqs.length > 1}
	<ListRow
		label={m.eq_target()}
		description={absent ? m.eq_target_absent({ eqs: absent }) : undefined}
	>
		{#snippet trailing()}
			<!-- The segment follows the EQ the store edits, not the press: a switch can wait on the
				dialog, or not happen. -->
			<SegmentedControl
				label={m.eq_target()}
				bind:value={() => selected, (next) => void devicePeqService.selectEq(eqs[Number(next)].id)}
				{options}
				disabled={devicePeqStore.isBusy || !devicePeqStore.canEdit}
				class="w-40 touch:w-48"
			/>
		{/snippet}
	</ListRow>
{/if}

<ModalDialog
	bind:open={() => leaving !== null, (open) => !open && devicePeqService.leaveEq('cancel')}
	title={m.eq_leave_title({ eq: named(devicePeqStore.eq) })}
	description={m.eq_leave_body({ eq: named(devicePeqStore.eq), next: named(leaving?.to) })}
>
	{#snippet footer()}
		<Button
			title={m.eq_leave_cancel()}
			variant="ghost"
			onclick={() => devicePeqService.leaveEq('cancel')}
		>
			{m.eq_leave_cancel()}
		</Button>
		<Button
			title={m.eq_leave_discard()}
			variant="ghost"
			onclick={() => devicePeqService.leaveEq('discard')}
		>
			{m.eq_leave_discard()}
		</Button>
		<Button title={m.eq_leave_write()} onclick={() => devicePeqService.leaveEq('write')}>
			{m.eq_leave_write()}
		</Button>
	{/snippet}
</ModalDialog>
