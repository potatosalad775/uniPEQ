<!--
	The phone's band editor: a sheet over the bottom of the screen while a band is selected. Not
	modal, so the graph above stays live and a node can still be dragged while the sheet is up.
	Android back (or the close button) deselects, which closes it. Previous and next step through
	the bands without closing.
-->
<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import Button from '#lib/components/atoms/Button.svelte';
	import Sheet from '#lib/components/atoms/Sheet.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
	import { eqStore } from '#lib/stores/eq-store.svelte.js';
	import { TYPE_LABEL } from './type-labels';
	import BandEditor from './BandEditor.svelte';

	let { index }: { index: number } = $props();

	const filter = $derived(eqStore.filters[index]);
	const count = $derived(eqStore.filters.length);
	const title = $derived(
		filter
			? `${m.eq_band_number({ band: index + 1 })} · ${TYPE_LABEL[filter.type]()}`
			: m.eq_band_editor()
	);
</script>

<Sheet
	bind:open={() => true, (open) => !open && eqStore.select(null)}
	modal={false}
	{title}
	class={eqConstraintStore.isGraphic ? '' : 'pb-[calc(0.5rem+var(--inset-bottom))]'}
>
	{#snippet actions()}
		<Button
			title={m.eq_band_previous()}
			size="icon-sm"
			variant="ghost"
			disabled={index === 0}
			onclick={() => eqStore.select(index - 1)}
		>
			<ChevronLeft class="size-4" aria-hidden="true" />
		</Button>
		<Button
			title={m.eq_band_next()}
			size="icon-sm"
			variant="ghost"
			disabled={index >= count - 1}
			onclick={() => eqStore.select(index + 1)}
		>
			<ChevronRight class="size-4" aria-hidden="true" />
		</Button>
	{/snippet}
	<BandEditor {index} header={false} />
</Sheet>
