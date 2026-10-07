/**
 * The band list being edited: what the graph shows, a read or a loaded preset replaces, and a push
 * writes. Editing and undo/redo controls arrive with the Main screen (docs/rebuild-plan.md,
 * Phase 4).
 *
 * Arrays are replaced, never mutated (`$state.raw`), so "did the list change" is an identity check.
 */
import { derivePreamp } from '$lib/eq/eq-preamp';
import type { EqFilter } from '$lib/eq/model';
import { UndoRedoStack } from '$lib/services/undo-redo-stack';

class EqStore {
	filters = $state.raw<EqFilter[]>([]);
	/** The preamp follows the bands (`derivePreamp`): a preset's `pregain: 'auto'`. */
	autoPreamp = $state(false);
	/** dB, as read from a device or set by hand; ignored while `autoPreamp`. */
	manualPreamp = $state(0);
	/** dB: what a push sends, where the device takes a preamp. */
	preamp = $derived(this.autoPreamp ? derivePreamp(this.filters) : this.manualPreamp);

	readonly history = new UndoRedoStack();

	/**
	 * Replace the whole list (a device read, a loaded preset), as one undoable step. `preamp`:
	 * a fixed value, `'auto'` to follow the bands, or undefined to keep the current one.
	 */
	replace(filters: EqFilter[], preamp?: number | 'auto'): void {
		this.history.record({ filters: this.filters, preamp: this.preamp });
		this.filters = filters;
		if (preamp === 'auto') this.autoPreamp = true;
		else if (preamp !== undefined) {
			this.autoPreamp = false;
			this.manualPreamp = preamp;
		}
	}

	/** The preamp as a preset stores it. */
	get pregain(): number | 'auto' {
		return this.autoPreamp ? 'auto' : this.manualPreamp;
	}
}

export const eqStore = new EqStore();
