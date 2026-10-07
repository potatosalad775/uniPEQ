import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EqFilter } from '$lib/eq/model';
import { COALESCE_MS, eqStore } from './eq-store.svelte';

const pk = (freq: number, gain: number): EqFilter => ({
	type: 'PK',
	freq,
	q: 1,
	gain,
	enabled: true
});

describe('eqStore editing', () => {
	beforeEach(() => {
		eqStore.reset();
		eqStore.replace([pk(100, 3), pk(1000, -2)], -3);
		eqStore.history.clear();
	});

	afterEach(() => vi.useRealTimers());

	it('updates one band as one undoable step, and undo/redo walk it', () => {
		expect(eqStore.canUndo).toBe(false);
		eqStore.update(1, { gain: 4 });
		expect(eqStore.filters[1].gain).toBe(4);
		expect(eqStore.canUndo).toBe(true);

		eqStore.undo();
		expect(eqStore.filters[1].gain).toBe(-2);
		expect(eqStore.canRedo).toBe(true);
		eqStore.redo();
		expect(eqStore.filters[1].gain).toBe(4);
	});

	it('records nothing for a patch that changes nothing', () => {
		eqStore.update(0, { gain: 3 });
		expect(eqStore.canUndo).toBe(false);
	});

	it('coalesces edits under one key into one step, until the key changes or time passes', () => {
		vi.useFakeTimers();
		eqStore.update(0, { gain: 4 }, 'slider-gain-0');
		eqStore.update(0, { gain: 5 }, 'slider-gain-0');
		eqStore.update(0, { gain: 6 }, 'slider-gain-0');
		eqStore.undo();
		expect(eqStore.filters[0].gain).toBe(3);
		expect(eqStore.canUndo).toBe(false);

		eqStore.redo();
		eqStore.update(0, { gain: 7 }, 'slider-gain-0');
		vi.advanceTimersByTime(COALESCE_MS + 1);
		eqStore.update(0, { gain: 8 }, 'slider-gain-0');
		eqStore.undo();
		expect(eqStore.filters[0].gain).toBe(7);
	});

	it('makes a gesture one step: record once, then edits without history', () => {
		eqStore.record();
		eqStore.update(0, { freq: 120 }, false);
		eqStore.update(0, { freq: 150 }, false);
		eqStore.undo();
		expect(eqStore.filters[0].freq).toBe(100);
	});

	it('adds a band and selects it; removing keeps the selection on its band', () => {
		eqStore.add(pk(5000, 1));
		expect(eqStore.filters).toHaveLength(3);
		expect(eqStore.selected).toBe(2);

		eqStore.remove(0);
		expect(eqStore.selected).toBe(1);
		expect(eqStore.filters[1].freq).toBe(5000);
		eqStore.remove(1);
		expect(eqStore.selected).toBeNull();
	});

	it('undo restores whether the preamp followed the bands', () => {
		eqStore.setAutoPreamp(true);
		expect(eqStore.autoPreamp).toBe(true);
		expect(eqStore.preamp).toBeLessThan(0);
		eqStore.setPreamp(-6);
		expect(eqStore.autoPreamp).toBe(false);
		expect(eqStore.preamp).toBe(-6);

		eqStore.undo();
		expect(eqStore.autoPreamp).toBe(true);
		eqStore.undo();
		expect(eqStore.autoPreamp).toBe(false);
		expect(eqStore.preamp).toBe(-3);
	});

	it('turning Auto off keeps the preamp where Auto had it', () => {
		eqStore.setAutoPreamp(true);
		const auto = eqStore.preamp;
		eqStore.setAutoPreamp(false);
		expect(eqStore.preamp).toBe(auto);
	});

	it('drops a selection that undo takes away', () => {
		eqStore.add(pk(5000, 1));
		expect(eqStore.selected).toBe(2);
		eqStore.undo();
		expect(eqStore.selected).toBeNull();
	});
});
