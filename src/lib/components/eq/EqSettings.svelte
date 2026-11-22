<!--
	The settings of the EQ the band card edits (eqcaps controls marked `eq`: a Qudelix's headroom per
	EQ, its user EQ's crossfeed), under the EQ row and above the channels, since they are the EQ's
	and not a channel's. Only the picked EQ's: picking the other shows that one's instead, so the
	place says whose they are and no label has to. Rows like the device panel's (`ControlRows`), not
	band rows: the device takes a change at once, so it is no edit to write later, and the list, its
	undo steps and its sync state never hear of it. Off while the EQ is switched off, when the device
	refuses them; one the device doesn't have now (its mode lacks that EQ) is not there.
-->
<script lang="ts">
	import ControlRows from '#lib/components/device/ControlRows.svelte';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
</script>

<ControlRows
	controls={devicePeqStore.eqControls}
	disabled={!devicePeqStore.canEdit || devicePeqStore.eqEnabled === false}
/>
