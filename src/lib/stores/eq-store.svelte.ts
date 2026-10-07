/**
 * The band list being edited: what the graph shows, a read or a loaded preset replaces, and a push
 * writes. Every change goes through a method here, so each is one undoable step (or part of one:
 * see `update`'s `history`).
 *
 * Arrays are replaced, never mutated (`$state.raw`), so "did the list change" is an identity check.
 * The store doesn't know the device's limits: callers project edits first (`editFilter` in
 * `$lib/eq/eq-constraint`), and nothing here ever folds the list onto a profile on its own
 * (device-peq invariant 3).
 */
import { derivePreamp } from '$lib/eq/eq-preamp';
import { eqFiltersEqual, type EqFilter, type EqState } from '$lib/eq/model';
import { UndoRedoStack } from '$lib/services/undo-redo-stack';

/** What undo restores: the list, the preamp as set by hand, and whether it follows the bands. */
export type EqSnapshot = EqState & { autoPreamp: boolean };

/** Edits sharing a coalesce key this close together are one undo step: a drag, a held arrow key. */
export const COALESCE_MS = 1500;

class EqStore {
	filters = $state.raw<EqFilter[]>([]);
	/** The preamp follows the bands (`derivePreamp`): a preset's `pregain: 'auto'`. */
	autoPreamp = $state(false);
	/** dB, as read from a device or set by hand; ignored while `autoPreamp`. */
	manualPreamp = $state(0);
	/** dB: what a push sends, where the device takes a preamp. */
	preamp = $derived(this.autoPreamp ? derivePreamp(this.filters) : this.manualPreamp);
	/** The band the graph and the band editor are on, by index; null when none is. */
	selected = $state<number | null>(null);

	readonly history = new UndoRedoStack<EqSnapshot>();
	/** Bumped whenever the history changes: `UndoRedoStack` itself isn't reactive. */
	#historyVersion = $state(0);
	#coalesceKey: string | null = null;
	#coalesceAt = 0;

	get canUndo(): boolean {
		void this.#historyVersion;
		return this.history.canUndo;
	}

	get canRedo(): boolean {
		void this.#historyVersion;
		return this.history.canRedo;
	}

	/** The preamp as a preset stores it. */
	get pregain(): number | 'auto' {
		return this.autoPreamp ? 'auto' : this.manualPreamp;
	}

	#snapshot(): EqSnapshot {
		return { filters: this.filters, preamp: this.manualPreamp, autoPreamp: this.autoPreamp };
	}

	#restore(s: EqSnapshot): void {
		this.filters = s.filters;
		this.manualPreamp = s.preamp;
		this.autoPreamp = s.autoPreamp;
		if (this.selected !== null && this.selected >= s.filters.length) this.selected = null;
	}

	/**
	 * Snapshot the state before a change. Call it once when a gesture starts (a graph drag), then
	 * make its edits with `history: false`.
	 */
	record(): void {
		this.history.record(this.#snapshot());
		this.#coalesceKey = null;
		this.#historyVersion++;
	}

	/** Record unless this edit continues the last one under the same key (see `COALESCE_MS`). */
	#recordFor(history: boolean | string): void {
		if (history === false) return;
		const now = Date.now();
		if (typeof history === 'string') {
			const continues = history === this.#coalesceKey && now - this.#coalesceAt < COALESCE_MS;
			if (!continues) this.record();
			this.#coalesceKey = history;
			this.#coalesceAt = now;
			return;
		}
		this.record();
	}

	/**
	 * Replace the whole list (a device read, a loaded preset, Fit), as one undoable step. `preamp`:
	 * a fixed value, `'auto'` to follow the bands, or undefined to keep the current one.
	 */
	replace(filters: EqFilter[], preamp?: number | 'auto'): void {
		this.record();
		this.filters = filters;
		if (preamp === 'auto') this.autoPreamp = true;
		else if (preamp !== undefined) {
			this.autoPreamp = false;
			this.manualPreamp = preamp;
		}
		if (this.selected !== null && this.selected >= filters.length) this.selected = null;
	}

	/**
	 * Change band `index`. `history`: true records an undo step, false doesn't (the caller already
	 * did, at a gesture's start), and a string coalesces edits under that key into one step.
	 * A patch that changes nothing records nothing.
	 */
	update(index: number, patch: Partial<EqFilter>, history: boolean | string = true): void {
		const current = this.filters[index];
		if (!current) return;
		const next = { ...current, ...patch };
		if (eqFiltersEqual(current, next)) return;
		this.#recordFor(history);
		this.filters = this.filters.with(index, next);
	}

	/** Append a band and select it. */
	add(filter: EqFilter): void {
		this.record();
		this.filters = [...this.filters, filter];
		this.selected = this.filters.length - 1;
	}

	/** Remove band `index`; the selection stays on the band it was on, if that one is left. */
	remove(index: number): void {
		if (!this.filters[index]) return;
		this.record();
		this.filters = this.filters.filter((_, i) => i !== index);
		const s = this.selected;
		if (s === index) this.selected = null;
		else if (s !== null && s > index) this.selected = s - 1;
	}

	/** Set the preamp by hand (which stops it following the bands). */
	setPreamp(db: number, history: boolean | string = true): void {
		if (!this.autoPreamp && this.manualPreamp === db) return;
		this.#recordFor(history);
		this.autoPreamp = false;
		this.manualPreamp = db;
	}

	/** Let the preamp follow the bands, or stop: it then stays where it was, not where it was set. */
	setAutoPreamp(on: boolean): void {
		if (this.autoPreamp === on) return;
		this.record();
		if (!on) this.manualPreamp = derivePreamp(this.filters);
		this.autoPreamp = on;
	}

	undo(): void {
		const previous = this.history.undo(this.#snapshot());
		this.#coalesceKey = null;
		this.#historyVersion++;
		if (previous) this.#restore(previous);
	}

	redo(): void {
		const next = this.history.redo(this.#snapshot());
		this.#coalesceKey = null;
		this.#historyVersion++;
		if (next) this.#restore(next);
	}

	select(index: number | null): void {
		this.selected = index !== null && this.filters[index] ? index : null;
	}

	/** For specs: an empty list, no history. */
	reset(): void {
		this.filters = [];
		this.autoPreamp = false;
		this.manualPreamp = 0;
		this.selected = null;
		this.history.clear();
		this.#coalesceKey = null;
		this.#historyVersion++;
	}
}

export const eqStore = new EqStore();
