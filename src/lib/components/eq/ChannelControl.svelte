<!--
	Which channel the band card edits, for a device that holds an EQ per output channel: both alike
	(L+R), or the left or the right on its own. Picking L or R from L+R sets the channels apart, the
	right starting as a copy of the left; L+R makes both the channel on screen. Each is an undo step.
	The first row of the band card, since the preamp is per channel too. Shown where the device
	drives its channels apart, and while they are apart anywhere (read-only after a disconnect), so a
	channel is never out of sight.
-->
<script lang="ts">
	import ListRow from '#lib/components/atoms/ListRow.svelte';
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
</script>

{#if shown}
	<ListRow label={m.eq_channels()}>
		{#snippet trailing()}
			<SegmentedControl
				label={m.eq_channels()}
				value={eqStore.editing}
				{options}
				disabled={!eqConstraintStore.editable}
				onValueChange={(next) => eqStore.edit(next)}
				class="w-32 touch:w-40"
			/>
		{/snippet}
	</ListRow>
{/if}
