<!--
	Which channel the band card edits, for a device that holds an EQ per output channel: both alike
	(L+R), or the left or the right on its own. Picking L or R from L+R sets the channels apart, the
	right starting as a copy of the left; L+R makes both the channel on screen, and asks first when
	that would replace a channel that differs: with auto-write the device loses it at once. Each is an
	undo step.
	The first row of the band card, since the preamp is per channel too. Shown where the device
	drives its channels apart, and while they are apart anywhere (read-only after a disconnect), so a
	channel is never out of sight.
-->
<script lang="ts">
	import Button from '#lib/components/atoms/Button.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import ModalDialog from '#lib/components/atoms/ModalDialog.svelte';
	import SegmentedControl from '#lib/components/atoms/SegmentedControl.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';

	const shown = $derived(devicePeqStore.perChannel || !eqStore.linked);
	const options = $derived([
		{ value: 'both', label: m.eq_channels_both(), title: m.eq_channels_both_title() },
		{ value: 'left', label: m.eq_channels_left(), title: m.eq_channels_left_title() },
		{ value: 'right', label: m.eq_channels_right(), title: m.eq_channels_right_title() }
	] as const);

	/** L+R was picked while the channels differ: the dialog asks before one is replaced. */
	let linking = $state(false);
	const pick = (next: (typeof options)[number]['value']) => {
		if (next === 'both' && eqStore.differ) linking = true;
		else eqStore.edit(next);
	};
	const link = () => {
		linking = false;
		eqStore.edit('both');
	};
</script>

{#if shown}
	<ListRow label={m.eq_channels()}>
		{#snippet trailing()}
			<SegmentedControl
				label={m.eq_channels()}
				bind:value={() => eqStore.editing, pick}
				{options}
				disabled={!eqConstraintStore.editable}
				class="w-32 touch:w-40"
			/>
		{/snippet}
	</ListRow>
{/if}

<ModalDialog
	bind:open={linking}
	title={m.eq_channels_link_title()}
	description={eqStore.editing === 'right'
		? m.eq_channels_link_body_right()
		: m.eq_channels_link_body_left()}
>
	{#snippet footer()}
		<Button title={m.eq_channels_link_cancel()} variant="ghost" onclick={() => (linking = false)}>
			{m.eq_channels_link_cancel()}
		</Button>
		<Button title={m.eq_channels_link_confirm()} onclick={link}>
			{m.eq_channels_link_confirm()}
		</Button>
	{/snippet}
</ModalDialog>
