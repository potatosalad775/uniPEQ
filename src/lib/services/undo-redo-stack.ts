/**
 * Snapshot-based undo/redo for EqState. Caller decides when to snapshot
 * (on slider release, not per tick) so drags coalesce naturally.
 */
import type { EqState } from '$lib/eq/model';

const MAX_ENTRIES = 100;

function clone(state: EqState): EqState {
	return { pregain: state.pregain, filters: state.filters.map((f) => ({ ...f })) };
}

export class UndoRedoStack {
	private past: EqState[] = [];
	private future: EqState[] = [];

	get canUndo(): boolean {
		return this.past.length > 0;
	}
	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/** Record the state as it was BEFORE a change is applied. */
	record(stateBeforeChange: EqState): void {
		this.past.push(clone(stateBeforeChange));
		if (this.past.length > MAX_ENTRIES) this.past.shift();
		this.future = [];
	}

	undo(currentState: EqState): EqState | undefined {
		const previous = this.past.pop();
		if (!previous) return undefined;
		this.future.push(clone(currentState));
		return previous;
	}

	redo(currentState: EqState): EqState | undefined {
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
