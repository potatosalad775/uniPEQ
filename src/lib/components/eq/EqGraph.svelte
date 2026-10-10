<!--
	The EQ response and one node per band: a slim graph, not modernGraphTool's GraphEngine (which is
	built around measurement curves). Gestures, after modernGraphTool's GraphEqOverlay ideas but on pointer events so
	touch and mouse share one path:
	- drag a node: frequency across, gain up and down (each only where the slot lets it move);
	- tap a node: select it (the band editor follows); tap the background: deselect;
	- pinch (two fingers, anywhere) or the wheel: Q of the selected band (the wheel: of the node
	  under the pointer first);
	- double-click the background: add a band there (only without a device band count);
	- keys on a focused node: arrows move it, Page Up/Down change Q, Delete removes it (or, for a
	  device's set bands, resets it to flat: decision 23).
	A drag is one undo step, and moves less than 3 px are a tap, not a drag. While the device is away
	the graph is read-only (decision 25): no gestures or keys, dimmed nodes.
-->
<script lang="ts">
	import { usesGain } from '@potatosalad775/eqcaps-core';
	import { combinedResponseDb, logFreqGrid } from '$lib/eq/biquad';
	import { editFilter, flatBand, newBand, slotOf } from '$lib/eq/eq-constraint';
	import {
		dbAt,
		dbRange,
		freqAt,
		freqLabel,
		GRID_FREQS,
		gridDbs,
		nodeDb,
		PAD,
		pathOf,
		pinchQ,
		wheelQ,
		xOf,
		yOf,
		type Plot
	} from '$lib/eq/graph-scale';
	import type { EqFilter } from '$lib/eq/model';
	import { nudge, roundField } from '$lib/eq/nudge';
	import * as m from '$lib/paraglide/messages';
	import { eqConstraintStore } from '$lib/stores/eq-constraint-store.svelte';
	import { eqStore } from '$lib/stores/eq-store.svelte';
	import { formatDb, formatHz, formatQ } from './type-labels';

	/** A move shorter than this is a tap. */
	const TAP_SLOP = 3;
	const FREQS = logFreqGrid(240);

	let width = $state(0);
	let height = $state(0);
	let svg: SVGSVGElement | undefined = $state();
	let focused = $state<number | null>(null);
	/** The dB range is held while a gesture runs, so the plot doesn't rescale under the finger. */
	let heldDb = $state<number | null>(null);

	const filters = $derived(eqStore.filters);
	const profile = $derived(eqConstraintStore.profile);
	const editable = $derived(eqConstraintStore.editable);
	const response = $derived(combinedResponseDb(filters, FREQS));
	const liveDb = $derived(dbRange(profile, filters, response));
	const plot: Plot = $derived({ width, height, db: heldDb ?? liveDb });
	const xs = $derived(FREQS.map((f) => xOf(f, plot)));
	const responsePath = $derived(
		pathOf(
			xs,
			response.map((r) => yOf(r, plot))
		)
	);
	const zeroY = $derived(yOf(0, plot));
	const selected = $derived(eqStore.selected);
	/** The selected band's own curve, filled down to 0 dB. */
	const selectedArea = $derived.by(() => {
		const f = selected === null ? undefined : filters[selected];
		if (!f) return '';
		const own = combinedResponseDb([f], FREQS);
		const line = pathOf(
			xs,
			own.map((r) => yOf(r, plot))
		);
		return `${line}L${xs[xs.length - 1].toFixed(1)},${zeroY.toFixed(1)}L${xs[0].toFixed(1)},${zeroY.toFixed(1)}Z`;
	});

	function bandLabel(f: EqFilter, i: number): string {
		const parts = [m.eq_band_number({ band: i + 1 }), f.type, formatHz(f.freq)];
		if (usesGain(f.type)) parts.push(formatDb(f.gain));
		parts.push(`Q ${formatQ(f.q)}`);
		return parts.join(', ');
	}

	// ── Editing one band through its slot ────────────────────────────────────

	function slotIndex(i: number): number {
		return eqConstraintStore.slots[i] ?? i;
	}

	/** Apply `patch` to band `i`, projected onto its slot. */
	function edit(i: number, patch: Partial<EqFilter>, history: boolean | string): void {
		const f = filters[i];
		if (!f) return;
		eqStore.update(i, editFilter(f, patch, profile, slotIndex(i)), history);
	}

	function locked(i: number) {
		const f = filters[i];
		return slotOf(profile, slotIndex(i), f).locked;
	}

	// ── Pointer gestures ─────────────────────────────────────────────────────

	// Gesture bookkeeping, never rendered: none of it is reactive on purpose.
	type Point = { x: number; y: number };
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointers down, by id; not shown
	const pointers = new Map<number, Point>();
	let drag: { id: number; index: number; start: Point; moved: boolean } | null = null;
	let pinch: { index: number; startQ: number; startDistance: number; recorded: boolean } | null =
		null;
	let tap: { id: number; start: Point } | null = null;
	let hovered: number | null = null;
	let frame = 0;
	let queued: (() => void) | null = null;

	/** Coalesce moves to one edit per frame. */
	function schedule(run: () => void): void {
		queued = run;
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			const next = queued;
			queued = null;
			next?.();
		});
	}

	function local(e: { clientX: number; clientY: number }): Point {
		const rect = svg!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function bandOf(target: EventTarget | null): number | null {
		const el = target instanceof Element ? target.closest<SVGElement>('[data-band]') : null;
		return el ? Number(el.dataset.band) : null;
	}

	const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

	function startPinch(): void {
		drag = null;
		tap = null;
		const index = eqStore.selected;
		const f = index === null ? undefined : filters[index];
		if (index === null || !f || locked(index).q) return;
		const [a, b] = [...pointers.values()];
		pinch = { index, startQ: f.q, startDistance: distance(a, b), recorded: false };
		heldDb = plot.db;
	}

	function onpointerdown(e: PointerEvent): void {
		if (!editable || (e.button !== 0 && e.pointerType === 'mouse')) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		try {
			// Keep getting the moves when the finger leaves the plot.
			svg?.setPointerCapture(e.pointerId);
		} catch {
			// Not an active pointer (a synthetic event): the moves still arrive while over the plot.
		}
		if (pointers.size === 2) return startPinch();
		if (pointers.size > 2) return;
		const index = bandOf(e.target);
		if (index === null) {
			tap = { id: e.pointerId, start: p };
			return;
		}
		// Keep the browser from turning this into a text selection or a focus change of its own.
		e.preventDefault();
		eqStore.select(index);
		svg?.querySelector<SVGElement>(`[data-band="${index}"]`)?.focus({ preventScroll: true });
		drag = { id: e.pointerId, index, start: p, moved: false };
	}

	function onpointermove(e: PointerEvent): void {
		if (!pointers.has(e.pointerId)) {
			hovered = bandOf(e.target);
			return;
		}
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			const current = pinch;
			schedule(() => {
				if (!current.recorded) {
					eqStore.record();
					current.recorded = true;
				}
				const q = roundField('q', pinchQ(current.startQ, current.startDistance, distance(a, b)));
				edit(current.index, { q }, false);
			});
			return;
		}
		if (!drag || drag.id !== e.pointerId) return;
		const d = drag;
		if (!d.moved) {
			if (distance(p, d.start) < TAP_SLOP) return;
			d.moved = true;
			heldDb = plot.db;
			eqStore.record();
		}
		schedule(() => {
			const f = filters[d.index];
			if (!f) return;
			const lock = locked(d.index);
			const patch: Partial<EqFilter> = {};
			if (!lock.freq) patch.freq = roundField('freq', freqAt(p.x, plot));
			if (!lock.gain && usesGain(f.type)) patch.gain = roundField('gain', dbAt(p.y, plot));
			edit(d.index, patch, false);
		});
	}

	function onpointerup(e: PointerEvent): void {
		const p = pointers.get(e.pointerId);
		pointers.delete(e.pointerId);
		if (pinch && pointers.size < 2) pinch = null;
		if (drag?.id === e.pointerId) drag = null;
		if (tap?.id === e.pointerId) {
			if (p && distance(p, tap.start) < TAP_SLOP && e.type === 'pointerup') eqStore.select(null);
			tap = null;
		}
		if (pointers.size === 0) heldDb = null;
	}

	function ondblclick(e: MouseEvent): void {
		if (bandOf(e.target) !== null || !eqConstraintStore.canAdd) return;
		const p = local(e);
		const base = newBand(filters, profile);
		const slot = profile.bandCount === null ? 0 : Math.min(filters.length, profile.bandCount - 1);
		const at: Partial<EqFilter> = { freq: roundField('freq', freqAt(p.x, plot)) };
		if (usesGain(base.type)) at.gain = roundField('gain', dbAt(p.y, plot));
		eqStore.add(editFilter(base, at, profile, slot));
	}

	// The wheel needs a non-passive listener to keep the page from scrolling while it sets Q.
	$effect(() => {
		const el = svg;
		if (!el) return;
		const onwheel = (e: WheelEvent) => {
			if (!eqConstraintStore.editable) return;
			const index = hovered ?? eqStore.selected;
			const f = index === null ? undefined : filters[index];
			if (index === null || !f || locked(index).q) return;
			e.preventDefault();
			edit(index, { q: roundField('q', wheelQ(f.q, e.deltaY)) }, `wheel-q-${index}`);
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	$effect(() => () => cancelAnimationFrame(frame));

	// ── Keys on a focused node ───────────────────────────────────────────────

	function onkeydown(e: KeyboardEvent, i: number): void {
		const f = filters[i];
		if (!f || !editable) return;
		const slot = slotOf(profile, slotIndex(i), f);
		const step = (field: 'freq' | 'q' | 'gain', dir: 1 | -1) => {
			if (slot.locked[field] || (field === 'gain' && !usesGain(f.type))) return;
			const value = nudge(slot[field], field, f[field], dir, e.shiftKey);
			edit(i, { [field]: value }, `key-${field}-${i}`);
		};
		switch (e.key) {
			case 'ArrowLeft':
				step('freq', -1);
				break;
			case 'ArrowRight':
				step('freq', 1);
				break;
			case 'ArrowUp':
				step('gain', 1);
				break;
			case 'ArrowDown':
				step('gain', -1);
				break;
			case 'PageUp':
				step('q', 1);
				break;
			case 'PageDown':
				step('q', -1);
				break;
			case 'Delete':
			case 'Backspace':
				if (eqConstraintStore.canRemove(i)) eqStore.remove(i);
				else eqStore.update(i, flatBand(filters[i], profile, eqConstraintStore.slots[i] ?? i));
				break;
			case 'Enter':
			case ' ':
				eqStore.select(i);
				break;
			case 'Escape':
				eqStore.select(null);
				break;
			default:
				return;
		}
		e.preventDefault();
	}
</script>

<div
	class="relative h-full overflow-hidden bg-base-100 wide:rounded-xl"
	style:min-height="12rem"
	bind:clientWidth={width}
	bind:clientHeight={height}
>
	<svg
		bind:this={svg}
		{width}
		{height}
		class="touch-none select-none"
		style:position="absolute"
		style:inset="0"
		role="group"
		aria-label={m.eq_graph_label()}
		aria-describedby="eq-graph-help"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		onpointerleave={() => (hovered = null)}
		{ondblclick}
	>
		{#if width > 0 && height > 0}
			<g aria-hidden="true">
				{#each GRID_FREQS as f (f)}
					<line
						x1={xOf(f, plot)}
						x2={xOf(f, plot)}
						y1={PAD.top}
						y2={height - PAD.bottom}
						class="stroke-base-content/10"
					/>
					<text
						x={xOf(f, plot)}
						y={height - 5}
						text-anchor="middle"
						class="fill-graph-grid-text text-[10px]">{freqLabel(f)}</text
					>
				{/each}
				{#each gridDbs(plot.db) as d (d)}
					<line
						x1={PAD.left}
						x2={width - PAD.right}
						y1={yOf(d, plot)}
						y2={yOf(d, plot)}
						class={d === 0 ? 'stroke-base-content/30' : 'stroke-base-content/10'}
					/>
					<text
						x={PAD.left - 4}
						y={yOf(d, plot) + 3}
						text-anchor="end"
						class="fill-graph-grid-text text-[10px]">{d > 0 ? `+${d}` : d}</text
					>
				{/each}
				{#if selectedArea}
					<path d={selectedArea} class="fill-primary/10 stroke-primary/40" stroke-width="1" />
				{/if}
				<path d={responsePath} class="fill-none stroke-primary" stroke-width="2.5" />
			</g>

			{#each filters as f, i (i)}
				{@const x = xOf(f.freq, plot)}
				{@const y = yOf(nodeDb(f), plot)}
				{@const isSelected = i === selected}
				{@const violation = eqConstraintStore.violations[i]}
				{@const flagged =
					!!violation && (violation.type || violation.freq || violation.q || violation.gain)}
				<g
					data-band={i}
					role="button"
					tabindex={editable ? 0 : -1}
					aria-label={bandLabel(f, i)}
					aria-pressed={isSelected}
					aria-disabled={!editable}
					class="outline-none {editable
						? 'cursor-grab active:cursor-grabbing'
						: 'pointer-events-none opacity-50'}"
					onkeydown={(e) => onkeydown(e, i)}
					onfocus={() => (focused = i)}
					onblur={() => (focused = focused === i ? null : focused)}
				>
					<!-- A finger-sized target around the visible dot -->
					<circle cx={x} cy={y} r="20" class="fill-transparent" />
					{#if focused === i}
						<circle cx={x} cy={y} r="15" class="fill-none stroke-accent" stroke-width="2" />
					{/if}
					<circle
						cx={x}
						cy={y}
						r={isSelected ? 11 : 9}
						stroke-width={flagged ? 2.5 : 1.5}
						class="{isSelected ? 'fill-primary' : 'fill-base-content/70'} {flagged
							? 'stroke-error'
							: 'stroke-base-100'}"
					/>
					<text
						{x}
						y={y + 3.5}
						text-anchor="middle"
						class="pointer-events-none text-[10px] font-semibold {isSelected
							? 'fill-primary-content'
							: 'fill-base-100'}">{i + 1}</text
					>
				</g>
			{/each}
		{/if}
	</svg>

	{#if filters.length === 0}
		<p
			class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-12 pt-16 text-center text-sm text-base-content/60"
		>
			{m.eq_graph_empty()}
		</p>
	{/if}
	<p id="eq-graph-help" class="sr-only">{m.eq_graph_help()}</p>
</div>
