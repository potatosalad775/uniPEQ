/**
 * The band list being edited: what the graph shows, a read replaces and a push writes. Phase 2
 * keeps it to what a read needs; editing, undo/redo and preamp derivation arrive with the push path
 * and the Main screen (docs/rebuild-plan.md, Phases 3–4).
 *
 * Arrays are replaced, never mutated (`$state.raw`), so "did the list change" is an identity check.
 */
import type { EqFilter } from '$lib/eq/model';
import { UndoRedoStack } from '$lib/services/undo-redo-stack';

class EqStore {
	filters = $state.raw<EqFilter[]>([]);
	/** dB. */
	preamp = $state(0);

	readonly history = new UndoRedoStack();

	/** Replace the whole list (a device read, a loaded preset), as one undoable step. */
	replace(filters: EqFilter[], preamp?: number): void {
		this.history.record({ filters: this.filters, preamp: this.preamp });
		this.filters = filters;
		if (preamp !== undefined) this.preamp = preamp;
	}
}

export const eqStore = new EqStore();
