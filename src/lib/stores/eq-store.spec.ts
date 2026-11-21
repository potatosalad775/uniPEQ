import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EqFilter } from '#lib/eq/model.js';
import { COALESCE_MS, eqStore } from './eq-store.svelte';

const pk = (freq: number, gain: number): EqFilter => ({
	type: 'PK',
	freq,
	q: 1,
	gain
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

describe('eqStore with the channels apart', () => {
	beforeEach(() => {
		eqStore.reset();
		eqStore.open({ filters: [pk(100, 3), pk(1000, -2)], preamp: -3 });
	});

	it('starts linked: one list for both channels', () => {
		expect(eqStore.linked).toBe(true);
		expect(eqStore.editing).toBe('both');
		expect(eqStore.other).toBeNull();
		expect(eqStore.channels.right).toEqual(eqStore.channels.left);
	});

	it('sets the channels apart with the right a copy of the left, and edits one alone', () => {
		eqStore.edit('right');
		expect(eqStore.linked).toBe(false);
		expect(eqStore.editing).toBe('right');
		expect(eqStore.channels.right).toEqual(eqStore.channels.left);

		eqStore.update(0, { gain: 6 });
		eqStore.setPreamp(-6);
		expect(eqStore.channels.right.filters[0].gain).toBe(6);
		expect(eqStore.channels.right.manualPreamp).toBe(-6);
		expect(eqStore.channels.left.filters[0].gain).toBe(3);
		expect(eqStore.channels.left.manualPreamp).toBe(-3);
		expect(eqStore.other?.filters[0].gain).toBe(3);

		eqStore.edit('left');
		expect(eqStore.filters[0].gain).toBe(3);
		expect(eqStore.preamp).toBe(-3);
		expect(eqStore.other?.filters[0].gain).toBe(6);
	});

	it('links onto the channel on screen', () => {
		eqStore.edit('right');
		eqStore.update(0, { gain: 6 });
		eqStore.edit('both');
		expect(eqStore.linked).toBe(true);
		expect(eqStore.channels.left.filters[0].gain).toBe(6);
		expect(eqStore.channels.right.filters[0].gain).toBe(6);
	});

	it('undoes and redoes across setting apart and linking, onto the channel it changed', () => {
		eqStore.edit('right');
		eqStore.update(0, { gain: 6 });
		eqStore.edit('left');
		eqStore.update(1, { gain: 1 });
		eqStore.edit('both');
		expect(eqStore.channels.right.filters[0].gain).toBe(3);

		eqStore.undo();
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.right.filters[0].gain).toBe(6);
		expect(eqStore.channels.left.filters[1].gain).toBe(1);

		eqStore.undo();
		expect(eqStore.editing).toBe('left');
		expect(eqStore.channels.left.filters[1].gain).toBe(-2);

		eqStore.undo();
		expect(eqStore.editing).toBe('right');
		expect(eqStore.channels.right.filters[0].gain).toBe(3);

		eqStore.undo();
		expect(eqStore.linked).toBe(true);
		expect(eqStore.canUndo).toBe(false);

		eqStore.redo();
		eqStore.redo();
		expect(eqStore.linked).toBe(false);
		expect(eqStore.channels.right.filters[0].gain).toBe(6);
		expect(eqStore.channels.left.filters[0].gain).toBe(3);
	});

	it('records nothing for showing the other channel', () => {
		eqStore.edit('right');
		eqStore.edit('left');
		eqStore.edit('right');
		eqStore.undo();
		expect(eqStore.linked).toBe(true);
	});

	it('loads an EQ with a right channel apart, and one without as one list for both', () => {
		eqStore.load({
			filters: [pk(200, 1)],
			preamp: 'auto',
			right: { filters: [pk(300, -1)], preamp: -2 }
		});
		expect(eqStore.editing).toBe('left');
		expect(eqStore.channels.left).toEqual({
			filters: [pk(200, 1)],
			autoPreamp: true,
			manualPreamp: -3
		});
		expect(eqStore.channels.right).toEqual({
			filters: [pk(300, -1)],
			autoPreamp: false,
			manualPreamp: -2
		});

		eqStore.edit('right');
		eqStore.load({ filters: [pk(400, 2)], right: { filters: [pk(500, 2)] } });
		expect(eqStore.editing).toBe('right');
		expect(eqStore.filters).toEqual([pk(500, 2)]);

		eqStore.load({ filters: [pk(600, 2)], preamp: -1 });
		expect(eqStore.linked).toBe(true);
		expect(eqStore.filters).toEqual([pk(600, 2)]);
		eqStore.undo();
		expect(eqStore.editing).toBe('right');
	});

	it('opens a fresh start that no undo goes back past, apart or not', () => {
		eqStore.edit('right');
		eqStore.open({ filters: [pk(100, 1)], right: { filters: [pk(100, 2)] } });
		expect(eqStore.canUndo).toBe(false);
		expect(eqStore.linked).toBe(false);
	});
});
