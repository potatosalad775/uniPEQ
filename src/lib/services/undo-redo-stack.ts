/**
 * Snapshot-based undo/redo for EqState. Caller decides when to snapshot
 * (on slider release, not per tick) so drags coalesce naturally. A snapshot may carry more than
 * `EqState` (the EQ store keeps `autoPreamp` in it); every field is kept.
 */
import type { EqState } from '$lib/eq/model';

const MAX_ENTRIES = 100;

function clone<T extends EqState>(state: T): T {
	return { ...state, filters: state.filters.map((f) => ({ ...f })) };
}

export class UndoRedoStack<T extends EqState = EqState> {
	private past: T[] = [];
	private future: T[] = [];

	get canUndo(): boolean {
		return this.past.length > 0;
	}
	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/** Record the state as it was BEFORE a change is applied. */
	record(stateBeforeChange: T): void {
		this.past.push(clone(stateBeforeChange));
		if (this.past.length > MAX_ENTRIES) this.past.shift();
		this.future = [];
	}

	undo(currentState: T): T | undefined {
		const previous = this.past.pop();
		if (!previous) return undefined;
		this.future.push(clone(currentState));
		return previous;
	}

	redo(currentState: T): T | undefined {
		const next = this.future.pop();
		if (!next) return undefined;
		this.past.push(clone(currentState));
		return next;
	}

	clear(): void {
		this.past = [];
		this.future = [];
	}
}
