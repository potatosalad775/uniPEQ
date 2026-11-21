/**
 * The band list being edited: what the graph shows, a read or a loaded preset replaces, and a push
 * writes. Every change goes through a method here, so each is one undoable step (or part of one:
 * see `update`'s `history`).
 *
 * A device that holds an EQ per output channel can have them set apart (`edit`). The fields below
 * (`filters`, the preamp, `selected`) are then the channel on screen, and the other one waits
 * beside them, so every edit works on one channel without knowing there are two. Linked, the list
 * on screen drives both channels, and the right one is no list of its own.
 *
 * Arrays are replaced, never mutated (`$state.raw`), so "did the list change" is an identity check.
 * The store doesn't know the device's limits: callers project edits first (`editFilter` in
 * `#lib/eq/eq-constraint.js`), and nothing here ever folds the list onto a profile on its own
 * (device-peq invariant 3).
 */
import { derivePreamp, preampOf } from '#lib/eq/eq-preamp.js';
import {
	eqFiltersEqual,
	type Channel,
	type ChannelEq,
	type EqFilter,
	type EqLoad,
	type EqState
} from '#lib/eq/model.js';
import { UndoRedoStack } from '#lib/services/undo-redo-stack.js';

/** The channels set apart: which one is on screen, and the other one as it stands. */
type Apart = { channel: Channel; other: ChannelEq };

/**
 * What undo restores: the list, the preamp as set by hand, whether it follows the bands, and
 * whether the channels were apart (with the other one, and which was on screen).
 */
export type EqSnapshot = EqState & { autoPreamp: boolean; apart: Apart | null };

/** Edits sharing a coalesce key this close together are one undo step: a drag, a held arrow key. */
export const COALESCE_MS = 1500;

/** `channel` with `filters`, and the preamp as `preamp` says (left out: as it was). */
function withList(channel: ChannelEq, filters: EqFilter[], preamp?: number | 'auto'): ChannelEq {
	if (preamp === 'auto') return { ...channel, filters, autoPreamp: true };
	if (preamp === undefined) return { ...channel, filters };
	return { filters, autoPreamp: false, manualPreamp: preamp };
}

class EqStore {
	filters = $state.raw<EqFilter[]>([]);
	/**
	 * The preamp follows the bands (`derivePreamp`): a preset's `pregain: 'auto'`. On by default,
	 * so no edit can make the EQ louder than the source.
	 */
	autoPreamp = $state(true);
	/** dB, as read from a device or set by hand; ignored while `autoPreamp`. */
	manualPreamp = $state(0);
	/** dB: what a push sends, where the device takes a preamp. */
	preamp = $derived(this.autoPreamp ? derivePreamp(this.filters) : this.manualPreamp);
	/** The band the graph and the band editor are on, by index; null when none is. */
	selected = $state<number | null>(null);
	/** Null while linked: the list on screen is both channels'. */
	#apart = $state.raw<Apart | null>(null);

	readonly history = new UndoRedoStack<EqSnapshot>();
	/** Bumped whenever the history changes: `UndoRedoStack` itself isn't reactive. */
	#historyVersion = $state(0);
	#coalesceKey: string | null = null;
	#coalesceAt = 0;
	/** Bumped by every `open`: a fresh start, not an edit. */
	#opened = $state(0);

	get canUndo(): boolean {
		void this.#historyVersion;
		return this.history.canUndo;
	}

	get canRedo(): boolean {
		void this.#historyVersion;
		return this.history.canRedo;
	}

	/** Changes with every new undo step (and undo, redo): edits sharing it are one step. */
	get step(): number {
		return this.#historyVersion;
	}

	/** Changes with every `open`, which an undo can't go back past. */
	get epoch(): number {
		return this.#opened;
	}

	/** The preamp of the list on screen as a preset stores it. */
	get pregain(): number | 'auto' {
		return this.autoPreamp ? 'auto' : this.manualPreamp;
	}

	/** One list drives both channels. */
	get linked(): boolean {
		return this.#apart === null;
	}

	/** Which channel the list on screen is: both while linked. */
	get editing(): Channel | 'both' {
		return this.#apart?.channel ?? 'both';
	}

	/** The channel not on screen while the channels are apart, to read (a second curve); else null. */
	get other(): ChannelEq | null {
		return this.#apart?.other ?? null;
	}

	/** Each channel as a write or a preset takes it. While linked, both are the list on screen. */
	/**
	 * The channels are apart and hold different EQs, so linking them (`edit('both')`) would replace
	 * the one off screen. Apart but equal, linking loses nothing.
	 */
	get differ(): boolean {
		const apart = this.#apart;
		if (!apart) return false;
		const shown = this.#shown();
		const { other } = apart;
		return !(
			preampOf(shown) === preampOf(other) &&
			shown.filters.length === other.filters.length &&
			shown.filters.every((f, i) => eqFiltersEqual(f, other.filters[i]))
		);
	}

	get channels(): Record<Channel, ChannelEq> {
		const shown = this.#shown();
		const apart = this.#apart;
		if (!apart) return { left: shown, right: shown };
		return apart.channel === 'left'
			? { left: shown, right: apart.other }
			: { left: apart.other, right: shown };
	}

	#shown(): ChannelEq {
		return { filters: this.filters, autoPreamp: this.autoPreamp, manualPreamp: this.manualPreamp };
	}

	#show(channel: ChannelEq): void {
		this.filters = channel.filters;
		this.autoPreamp = channel.autoPreamp;
		this.manualPreamp = channel.manualPreamp;
		if (this.selected !== null && this.selected >= channel.filters.length) this.selected = null;
	}

	#snapshot(): EqSnapshot {
		return {
			filters: this.filters,
			preamp: this.manualPreamp,
			autoPreamp: this.autoPreamp,
			apart: this.#apart
		};
	}

	#restore(s: EqSnapshot): void {
		this.#show({ filters: s.filters, autoPreamp: s.autoPreamp, manualPreamp: s.preamp });
		this.#apart = s.apart;
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
	 * Replace the list on screen (Fit, a list from the link), as one undoable step. `preamp`: a
	 * fixed value, `'auto'` to follow the bands, or undefined to keep the current one. `history` as
	 * in `update`. With the channels apart, the other one stays as it is.
	 */
	replace(filters: EqFilter[], preamp?: number | 'auto', history: boolean | string = true): void {
		this.#recordFor(history);
		this.#show(withList(this.#shown(), filters, preamp));
	}

	/**
	 * Replace the whole EQ (a device read, a loaded preset), as one undoable step: with `right`,
	 * the channels apart, the one on screen staying on screen if they were apart already; without,
	 * one list for both. `history` as in `update`.
	 */
	load(eq: EqLoad, history: boolean | string = true): void {
		this.#recordFor(history);
		const { left: wasLeft, right: wasRight } = this.channels;
		const left = withList(wasLeft, eq.filters, eq.preamp);
		if (!eq.right) {
			this.#apart = null;
			this.#show(left);
			return;
		}
		const right = withList(wasRight, eq.right.filters, eq.right.preamp ?? eq.preamp);
		const channel = this.#apart?.channel ?? 'left';
		this.#apart = { channel, other: channel === 'left' ? right : left };
		this.#show(channel === 'left' ? left : right);
	}

	/**
	 * Take the EQ as a fresh start: what an automatic read brings in on connecting or switching
	 * presets. Nothing before it is undoable, since an undo there would hand the
	 * device another device's or preset's bands.
	 */
	open(eq: EqLoad): void {
		this.load(eq);
		this.history.clear();
		this.#coalesceKey = null;
		this.#historyVersion++;
		this.#opened++;
	}

	/**
	 * What the list on screen edits. A channel, while linked, sets the channels apart, the right
	 * starting as a copy of the left; both, while apart, links them, the list on screen becoming
	 * both channels'. Each is an undo step. Between left and right, only what is on screen changes.
	 */
	edit(target: Channel | 'both'): void {
		const apart = this.#apart;
		if (target === 'both') {
			if (!apart) return;
			this.record();
			this.#apart = null;
			return;
		}
		if (!apart) {
			this.record();
			this.#apart = { channel: target, other: this.#shown() };
			return;
		}
		if (apart.channel === target) return;
		this.#apart = { channel: target, other: this.#shown() };
		this.#show(apart.other);
		// An edit on this channel is never the one before it on the other, whatever its key.
		this.#coalesceKey = null;
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

	/**
	 * Let the preamp follow the bands, or stop: it then stays where it was, not where it was set.
	 * `history` as in `update`.
	 */
	setAutoPreamp(on: boolean, history: boolean | string = true): void {
		if (this.autoPreamp === on) return;
		this.#recordFor(history);
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

	/** For specs: an empty list for both channels, no history. */
	reset(): void {
		this.filters = [];
		this.autoPreamp = true;
		this.manualPreamp = 0;
		this.selected = null;
		this.#apart = null;
		this.history.clear();
		this.#coalesceKey = null;
		this.#historyVersion++;
	}
}

export const eqStore = new EqStore();
