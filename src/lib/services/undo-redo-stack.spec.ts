import { describe, expect, it } from 'vitest';
import type { EqState } from '$lib/eq/model';
import { UndoRedoStack } from './undo-redo-stack';

const state = (gain: number): EqState => ({
	preamp: -gain,
	filters: [{ type: 'PK', freq: 1000, q: 1, gain, enabled: true }]
});

describe('UndoRedoStack', () => {
	it('undoes to the snapshot taken before the change, then redoes', () => {
		const stack = new UndoRedoStack();
		expect(stack.canUndo).toBe(false);

		stack.record(state(1));
		expect(stack.undo(state(2))).toEqual(state(1));
		expect(stack.canUndo).toBe(false);
		expect(stack.canRedo).toBe(true);
		expect(stack.redo(state(1))).toEqual(state(2));
		expect(stack.canRedo).toBe(false);
	});

	it('stores copies, so later edits to the live state do not rewrite history', () => {
		const stack = new UndoRedoStack();
		const live = state(1);
		stack.record(live);
		live.filters[0].gain = 9;
		expect(stack.undo(live)?.filters[0].gain).toBe(1);
	});

	it('drops the redo branch on a new change', () => {
		const stack = new UndoRedoStack();
		stack.record(state(1));
		stack.undo(state(2));
		stack.record(state(1));
		expect(stack.canRedo).toBe(false);
	});

	it('returns undefined with nothing to undo or redo', () => {
		const stack = new UndoRedoStack();
		expect(stack.undo(state(0))).toBeUndefined();
		expect(stack.redo(state(0))).toBeUndefined();
	});

	it('keeps at most 100 entries, dropping the oldest', () => {
		const stack = new UndoRedoStack();
		for (let i = 0; i < 101; i++) stack.record(state(i));
		let last: EqState | undefined;
		let count = 0;
		for (let next = stack.undo(state(999)); next; next = stack.undo(next)) {
			last = next;
			count++;
		}
		expect(count).toBe(100);
		expect(last?.filters[0].gain).toBe(1);
	});

	it('clear() forgets both directions', () => {
		const stack = new UndoRedoStack();
		stack.record(state(1));
		stack.undo(state(2));
		stack.record(state(3));
		stack.clear();
		expect(stack.canUndo).toBe(false);
		expect(stack.canRedo).toBe(false);
	});
});
