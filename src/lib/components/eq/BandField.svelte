<!--
	One of a band's numbers (frequency, gain or Q): a number box and a slider, both bounded by the
	slot's domain. Adapted from the field handling in modernGraphTool
	src/lib/components/equalizer/EqFilterCard.svelte @ 23ddc4dd: a locked domain shows a read-only
	value, a value list slides along its values, Escape reverts what arrow keys already committed,
	and the hint says what the device takes. Arrow keys step musically (`nudge`), as on the graph.
-->
<script lang="ts">
	import { domainBounds, type Domain } from '@potatosalad775/eqcaps-core';
	import { domainHint } from '$lib/eq/eq-domain-hint';
	import { linearToLog, logToLinear } from '$lib/eq/log-scale';
	import { nudge, roundField, type BandField } from '$lib/eq/nudge';
	import * as m from '$lib/paraglide/messages';

	let {
		field,
		label,
		unit,
		value,
		domain,
		locked = false,
		violation = false,
		onChange
	}: {
		field: BandField;
		label: string;
		unit: string;
		value: number;
		domain: Domain;
		locked?: boolean;
		/** The value is outside what the device takes. */
		violation?: boolean;
		/** `history` as `eqStore.update` takes it: a coalesce key for slider drags and held keys. */
		onChange: (value: number, history: boolean | string) => void;
	} = $props();

	const id = $props.id();
	const bounds = $derived(domainBounds(domain));
	const values = $derived('values' in domain ? domain.values : null);
	const hint = $derived(domainHint(domain, unit));
	/** Log sliders for frequency and Q, as on every EQ; gain is linear. */
	const logScale = $derived(field !== 'gain' && bounds.min > 0);

	const SLIDER_STEPS = 1000;
	const sliderMax = $derived(values ? values.length - 1 : SLIDER_STEPS);
	const sliderValue = $derived.by(() => {
		if (values) {
			let best = 0;
			values.forEach((v, i) => {
				if (Math.abs(v - value) < Math.abs(values[best] - value)) best = i;
			});
			return best;
		}
		if (bounds.max <= bounds.min) return 0;
		if (logScale) return logToLinear(value, bounds.min, bounds.max, SLIDER_STEPS);
		return Math.round(((value - bounds.min) / (bounds.max - bounds.min)) * SLIDER_STEPS);
	});

	function fromSlider(position: number): number {
		if (values) return values[position];
		if (logScale) return roundField(field, linearToLog(position, bounds.min, bounds.max));
		return roundField(field, bounds.min + (position / SLIDER_STEPS) * (bounds.max - bounds.min));
	}

	let focusValue: number | null = null;

	function commit(input: HTMLInputElement) {
		const parsed = parseFloat(input.value);
		if (Number.isFinite(parsed)) onChange(parsed, true);
		// Show what landed (the store projects it onto the domain), or put back what was there.
		queueMicrotask(() => (input.value = String(value)));
	}

	function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		const input = e.currentTarget;
		if (e.key === 'Enter') {
			input.blur();
		} else if (e.key === 'Escape') {
			if (focusValue !== null && focusValue !== value) onChange(focusValue, true);
			input.value = String(focusValue ?? value);
			input.blur();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const next = nudge(domain, field, value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
			onChange(next, `key-${field}`);
			input.value = String(next);
		}
	}
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center justify-between gap-2">
		<label for="{id}-num" class="text-xs text-base-content/70">{label}</label>
		{#if locked}
			<span
				id="{id}-num"
				class="rounded bg-base-300 px-1.5 py-0.5 text-xs text-base-content/80 tabular-nums"
				title={m.eq_field_locked()}
			>
				{value}{unit ? ` ${unit}` : ''}
			</span>
		{:else}
			<span class="inline-flex items-baseline gap-1">
				<input
					id="{id}-num"
					type="number"
					inputmode="decimal"
					value={String(value)}
					min={bounds.min}
					max={bounds.max}
					step="any"
					aria-invalid={violation}
					aria-describedby="{id}-hint"
					onfocus={() => (focusValue = value)}
					onblur={() => (focusValue = null)}
					onchange={(e) => commit(e.currentTarget)}
					{onkeydown}
					class="w-20 [appearance:textfield] rounded bg-transparent px-1.5 py-1 text-right text-sm tabular-nums ring-1 outline-none focus:bg-base-200 focus:ring-accent/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
						{violation ? 'ring-error' : 'ring-base-content/25'}"
				/>
				{#if unit}<span class="text-xs text-base-content/60">{unit}</span>{/if}
			</span>
		{/if}
	</div>
	{#if !locked}
		<input
			type="range"
			min="0"
			max={sliderMax}
			step="1"
			value={sliderValue}
			aria-label={label}
			aria-valuetext="{value}{unit ? ` ${unit}` : ''}"
			oninput={(e) => onChange(fromSlider(Number(e.currentTarget.value)), `slider-${field}`)}
			class="h-6 w-full cursor-pointer accent-primary"
		/>
	{/if}
	<p id="{id}-hint" class="text-[11px] {violation ? 'text-error' : 'text-base-content/50'}">
		{violation ? m.eq_field_violation({ allowed: hint }) : m.eq_field_allowed({ allowed: hint })}
	</p>
</div>
