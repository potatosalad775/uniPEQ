<!--
	One of a band's numbers (frequency, gain or Q): a number box and a slider, both bounded by the
	slot's domain. Adapted from the field handling in modernGraphTool
	src/lib/components/equalizer/EqFilterCard.svelte @ 23ddc4dd: a locked domain shows a read-only
	value, a value list slides along its values, Escape reverts what arrow keys already committed,
	and the hint says what the device takes. Arrow keys step musically (`nudge`), as on the graph.
	For touch: − and + steppers either side of the number (the same musical steps, so
	repeated taps are one undo step), a touch-sized slider, and the allowed-range hint only while
	the number is being typed or the value is one the device won't take.
-->
<script lang="ts">
	import { Minus, Plus } from '@lucide/svelte';
	import { domainBounds, type Domain } from '@potatosalad775/eqcaps-core';
	import Slider from '$lib/components/atoms/Slider.svelte';
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
	let editing = $state(false);

	function step(dir: 1 | -1) {
		onChange(nudge(domain, field, value, dir), `key-${field}`);
	}
	const atMin = $derived(value <= bounds.min);
	const atMax = $derived(value >= bounds.max);

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

<div class="flex flex-col">
	<div class="flex items-center justify-between gap-2">
		<label for="{id}-num" class="text-sm text-base-content/70">{label}</label>
		{#if locked}
			<span
				id="{id}-num"
				class="rounded bg-base-300 px-2 py-1 text-sm text-base-content/80 tabular-nums"
				title={m.eq_field_locked()}
			>
				{value}{unit ? ` ${unit}` : ''}
			</span>
		{:else}
			<span class="inline-flex items-center gap-1">
				<button
					type="button"
					tabindex="-1"
					aria-label={m.eq_field_step_down({ field: label })}
					disabled={atMin}
					class="flex size-8 items-center justify-center rounded-full text-base-content/70 hover:bg-base-content/10 active:bg-base-content/15 disabled:opacity-40 touch:size-10"
					onclick={() => step(-1)}
				>
					<Minus class="size-4" aria-hidden="true" />
				</button>
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
						onfocus={() => {
							focusValue = value;
							editing = true;
						}}
						onblur={() => {
							focusValue = null;
							editing = false;
						}}
						onchange={(e) => commit(e.currentTarget)}
						{onkeydown}
						class="w-20 [appearance:textfield] rounded-md bg-transparent px-1.5 py-1 text-right text-sm tabular-nums ring-1 outline-none focus:bg-base-200 focus:ring-accent/60 touch:h-9 touch:text-base [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
							{violation ? 'ring-error' : 'ring-base-content/25'}"
					/>
					<span class="w-5 text-xs text-base-content/60">{unit}</span>
				</span>
				<button
					type="button"
					tabindex="-1"
					aria-label={m.eq_field_step_up({ field: label })}
					disabled={atMax}
					class="flex size-8 items-center justify-center rounded-full text-base-content/70 hover:bg-base-content/10 active:bg-base-content/15 disabled:opacity-40 touch:size-10"
					onclick={() => step(1)}
				>
					<Plus class="size-4" aria-hidden="true" />
				</button>
			</span>
		{/if}
	</div>
	{#if !locked}
		<Slider
			min={0}
			max={sliderMax}
			step={1}
			value={sliderValue}
			aria-label={label}
			aria-valuetext="{value}{unit ? ` ${unit}` : ''}"
			oninput={(e) => onChange(fromSlider(Number(e.currentTarget.value)), `slider-${field}`)}
		/>
	{/if}
	<p
		id="{id}-hint"
		class="text-xs {violation ? 'text-error' : 'text-base-content/50'} {violation || editing
			? ''
			: 'sr-only'}"
	>
		{violation ? m.eq_field_violation({ allowed: hint }) : m.eq_field_allowed({ allowed: hint })}
	</p>
</div>
