// Adapted from modernGraphTool src/lib/stores/device-peq-store.svelte.ts @ 23ddc4dd: no separate
// constraint store (the connected profile is the constraint), writable presets, and a device on no
// stored preset.
/**
 * The connected EQ device and what the app is doing with it.
 *
 * The connection's eqcaps profile is the active constraint while it lasts (`profile`). The device's
 * EQ is what the list edits: it is read on connecting unless the list holds changes
 * the device never got (`unwritten`), and it can't be edited while disconnected (`canEdit`). Bands
 * that don't fit are flagged, never refitted: Fit is the user's call.
 *
 * A device with several EQs is edited one EQ at a time (`eq`): `connection` is the device viewed
 * as that EQ, so the rest of this store, and everything that reads it, has one EQ to think about.
 */
import { deviceControls, eqControls } from '#lib/device-peq/controls.js';
import { deviceEqs, eqView, OWN_EQ, type EqTarget } from '#lib/device-peq/device-eqs.js';
import {
	readRequest,
	writeRequest,
	type CurrentSlot,
	type PresetRequest
} from '#lib/device-peq/preset.js';
import { drivesChannelsApart, type Layout } from '#lib/device-peq/push-plan.js';
import type { DeviceConnection, DeviceOperation, PeqCapabilities } from '#lib/device-peq/types.js';
import { preampOf } from '#lib/eq/eq-preamp.js';
import { eqFiltersEqual, type Channel, type EqState, type StereoEq } from '#lib/eq/model.js';
import { eqDisabledBy, type Control, type Profile } from '@potatosalad775/eqcaps-core';
import type { Slot } from '@potatosalad775/eqcaps-device-bridge';
import { eqStore } from './eq-store.svelte';

/**
 * What the Device EQ control shows: a listed preset (by id), the EQ off, a preset the device is
 * on that isn't listed (a built-in one), no preset (`unsaved`: its EQ changed since a preset was
 * loaded), or null when the device can't say.
 */
export type DeviceEqSelection = number | 'off' | 'other' | 'unsaved' | null;

/**
 * The band list and preamp as they were when last read from or written to the device; with
 * `right`, the right channel's too (left out: the same as the left).
 */
export type DeviceSnapshot = StereoEq;

class DevicePeqStore {
	/**
	 * The connection as the bridge opened it (every EQ the device has), which of its EQs the list
	 * edits, and the ones its current mode lacks. Replaced whole, so `connection` never pairs a
	 * device with another's EQ.
	 */
	#opened = $state.raw<{
		conn: DeviceConnection;
		eq: EqTarget;
		absent: readonly string[];
	} | null>(null);
	/**
	 * The connection viewed as the EQ the list edits (`eqView`): that EQ's profile, presets and
	 * channels, and the device viewed as it. Another EQ is another connection
	 * object, so what follows the connection (auto-write, the modernGraphTool link) takes an EQ
	 * switch for a new target, as it does a new device.
	 */
	connection = $derived(this.#opened && eqView(this.#opened.conn, this.#opened.eq));
	/** The EQ the list edits, with the band count the device reported for it; null while disconnected. */
	get openedEq(): EqTarget | null {
		return this.#opened?.eq ?? null;
	}
	/** The listed EQs the device's mode lacked when it was last asked. */
	get absent(): readonly string[] {
		return this.#opened?.absent ?? [];
	}
	/** The device's EQs, for the EQ row; empty while disconnected. */
	eqs = $derived(this.#opened ? deviceEqs(this.#opened.conn, this.#opened.absent) : []);
	/**
	 * The device the EQ is edited for: the connected one, or after a disconnect the
	 * last one, so a dropped cable doesn't take the editor with it. Null until a first connection:
	 * the EQ tab then asks for a device. `profile` and `eq` are the EQ the list was for.
	 */
	knownDevice = $state.raw<{ name: string; profile: Profile; eq: string | undefined } | null>(null);
	isConnecting = $state(false);
	/** The operation under way, one at a time; the service's runner sets it and the sync bar names it. */
	operation = $state<DeviceOperation | null>(null);
	/**
	 * The listed preset reads and writes target; null for none, the EQ where the device is: on a
	 * device that lists no presets, or one on none of them (`deviceSlot` `'unsaved'`), where naming
	 * one would save into a memory the user never picked.
	 */
	activeSlot = $state<number | null>(null);
	/**
	 * The preset the device is on, as it last reported or was told: may be unlisted (a built-in
	 * preset), the bypass preset, or none (`'unsaved'`). Null when unknown. Protocols that only read
	 * and write the current preset can reach `activeSlot` only while this equals it.
	 */
	deviceSlot = $state<CurrentSlot>(null);
	/** Whether the device's EQ is on, when known. */
	eqEnabled = $state<boolean | null>(null);
	/** What the device held after the last read or write, to tell whether the list has moved on. */
	synced = $state.raw<DeviceSnapshot | null>(null);
	/**
	 * The list holds changes the device never got, from before the device went away or the target
	 * preset changed (`hasUnwritten` at that moment). Connecting again doesn't read over them: the
	 * sync bar offers Write and Read instead.
	 */
	unwritten = $state(false);
	/** The list when what the device holds stopped being known (connecting, a preset change). */
	#baseline: DeviceSnapshot | null = null;
	/**
	 * The target preset's bands as read before a write, kept so later writes (auto-write above all)
	 * don't read again. Null hints: the preset couldn't be read. Dropped on any preset change.
	 */
	layout = $state.raw<{ slot: number | null; hints: Layout | null } | null>(null);
	/**
	 * When the waiting auto-write fires (`Date.now()` ms), while an edit waits for it; null
	 * otherwise. The sync bar counts it down.
	 */
	autoDueAt = $state<number | null>(null);
	/** Auto-write found a list the device can't hold exactly, and waits for a reviewed write. */
	autoPaused = $state(false);
	/** The last automatic write boosts with no way to lower the device's level. */
	autoClipRisk = $state(false);
	/**
	 * An automatic write failed, so auto-write is off until switched back on or the next connection.
	 * Kept out of the saved setting: one dropped connection shouldn't turn it off in later sessions.
	 */
	autoStopped = $state(false);
	/**
	 * The user went on past the volume warning on this connection, so writes may go out. Asked again
	 * on every connection: a write can pop or jump in level while audio plays.
	 */
	writeConsent = $state(false);
	/** The last operation's outcome, until the next one. */
	statusMessage = $state<string | null>(null);
	/** Whether `statusMessage` reports a failure, which outranks every other status line. */
	statusIsError = $state(false);
	/** The failure `statusMessage` reports: the operation and its eqcaps `BridgeError` code. */
	failure = $state.raw<{ op: string; code: string } | null>(null);
	/**
	 * The device dropped the connection after saving (some do by design), so the next operation
	 * needs a fresh one. The connection itself is kept for its name and `reopen`.
	 */
	needsReconnect = $state(false);
	/**
	 * The device's controls as last read, by id: null for one it doesn't have now. Empty until read,
	 * and for a device without controls.
	 */
	controlValues = $state.raw<Record<string, number | null>>({});
	/** The device's firmware version, when it says. */
	firmware = $state<string | null>(null);
	/**
	 * The presets the device holds, as it last listed them, for a device that keeps a list with
	 * names of its own (`listsSlots`); null for one whose presets are the profile's.
	 */
	deviceSlots = $state.raw<Slot[] | null>(null);

	get isConnected(): boolean {
		return this.connection !== null;
	}

	/**
	 * The connection as opened, every EQ: for what is about the device rather than one EQ (it
	 * going away, its controls).
	 */
	get opened(): DeviceConnection | null {
		return this.#opened?.conn ?? null;
	}

	/** The EQ the list edits: its id among `eqs`, undefined for the profile's own. */
	get eq(): string | undefined {
		return this.#opened?.eq.id;
	}

	/**
	 * The list can be edited: a device is connected and reachable. Disconnected, the
	 * list stays on screen read-only, to look at or save as a preset.
	 */
	get canEdit(): boolean {
		return this.connection !== null && !this.needsReconnect;
	}

	get isBusy(): boolean {
		return this.isConnecting || this.operation !== null;
	}

	/** The controls the device has now, in the profile's order. */
	get controls(): Control[] {
		const all = this.connection?.device.capabilities.controls ?? [];
		return all.filter((c) => typeof this.controlValues[c.id] === 'number');
	}

	/** The device's own settings among `controls`, for the device panel. */
	get deviceControls(): Control[] {
		return deviceControls(this.controls);
	}

	/**
	 * The settings of the EQ the list edits among `controls` (its headroom, its crossfeed), shown
	 * with it on the band card. The device takes them at once: they are no part of the list, of
	 * what a write sends or of whether the list is in sync.
	 */
	get eqControls(): Control[] {
		return eqControls(this.controls, this.eq);
	}

	/** The controls whose current value stops the device applying its EQ (upsampling, say). */
	get eqOffBy(): Control[] {
		return eqDisabledBy(this.controls, this.controlValues);
	}

	get deviceName(): string | null {
		return this.connection?.name ?? null;
	}

	/** What the device accepts: the active EQ constraint while connected. */
	get profile(): Profile | null {
		return this.connection?.profile ?? null;
	}

	get capabilities(): PeqCapabilities | null {
		return this.connection?.device.capabilities ?? null;
	}

	/** The connected device holds an EQ per output channel, driven apart: the EQ may be set apart. */
	get perChannel(): boolean {
		const c = this.connection;
		return !!c && drivesChannelsApart(c.profile, c.device.capabilities);
	}

	/** The protocol is unconfirmed for this device (a guessed one, or flagged in eqcaps). */
	get experimental(): boolean {
		const c = this.connection;
		return !!c && (c.device.capabilities.experimental || c.profileSource === 'guess');
	}

	/** EQ memories to read from and write to — the bypass preset is the off switch, not one. */
	get slots(): Slot[] {
		const all = this.deviceSlots ?? this.connection?.device.capabilities.slots ?? [];
		return all.filter((s) => !s.bypass);
	}

	/** How many presets the device has room for, where it keeps a list; null where they are fixed. */
	get slotRoom(): number | null {
		const caps = this.connection?.device.capabilities;
		if (!caps || this.deviceSlots === null) return null;
		return caps.slots.filter((s) => !s.bypass).length;
	}

	/** Presets can be created, renamed and deleted on this device. */
	get canEditPresets(): boolean {
		return !!this.connection?.device.capabilities.editsSlots && this.deviceSlots !== null;
	}

	/** The preset that turns the device's EQ off, if it has one. */
	get bypass(): Slot | null {
		return this.connection?.device.capabilities.slots.find((s) => s.bypass) ?? null;
	}

	/**
	 * The memories a write may target: the user presets eqcaps marks `writable`, not
	 * the built-in curves. A profile that marks none (all memories, a guessed device) leaves every
	 * preset but the bypass one writable (eqcaps SPEC §9).
	 */
	get writableSlots(): Slot[] {
		const marked = this.slots.filter((s) => s.writable);
		return marked.length ? marked : this.slots;
	}

	/** Whether the target preset is one the user may write; true for none, the EQ where it is. */
	get targetWritable(): boolean {
		const slot = this.activeSlot;
		return slot === null || this.writableSlots.some((s) => s.id === slot);
	}

	/** How Read reaches what Device EQ shows, or null when it can't from where the device is. */
	get readTarget(): PresetRequest | null {
		const caps = this.connection?.device.capabilities;
		if (!caps) return null;
		// A built-in preset is read where the device is: it's what the control shows.
		if (this.selection === 'other') return caps.canRead ? {} : null;
		return readRequest(caps, this.activeSlot, this.deviceSlot);
	}

	/**
	 * How Write reaches the target preset, or null when it can't from where the device is, or the
	 * target is a built-in preset. Never retargets: picking a writable preset is the
	 * user's call.
	 */
	get writeTarget(): PresetRequest | null {
		const caps = this.connection?.device.capabilities;
		if (!caps || !this.targetWritable) return null;
		return writeRequest(caps, this.activeSlot, this.deviceSlot);
	}

	/** Whether the list still matches the last read or write; null before either. */
	get inSync(): boolean | null {
		return this.synced ? this.#holds(this.synced) : null;
	}

	/**
	 * While connected: the list has changes the device doesn't have, as far as the app can tell.
	 * Against the last read or write when there is one, else against the list as it was when the
	 * device's content stopped being known, plus whatever was already unwritten then.
	 */
	get hasUnwritten(): boolean {
		if (this.synced) return !this.#holds(this.synced);
		return this.unwritten || (this.#baseline !== null && !this.#holds(this.#baseline));
	}

	/**
	 * Each channel's list and preamp equal `snapshot`'s (the preamp only where the device takes
	 * one). Linked, both channels are the list on screen.
	 */
	#holds(snapshot: DeviceSnapshot): boolean {
		const preampMatters = this.connection?.device.capabilities.writesPreamp ?? false;
		const same = (held: EqState, now: EqState) =>
			held.filters.length === now.filters.length &&
			held.filters.every((f, i) => eqFiltersEqual(f, now.filters[i])) &&
			(!preampMatters || held.preamp === now.preamp);
		const now = this.snapshot();
		return same(snapshot, now) && same(snapshot.right ?? snapshot, now.right);
	}

	/** Both channels as they are now, as `synced` keeps them. */
	snapshot(): DeviceSnapshot & { right: EqState } {
		const { channels, editing } = eqStore;
		// The list on screen's preamp is the store's own, worked out once per edit: this runs on
		// every frame of a drag.
		const state = (side: Channel): EqState => ({
			filters: channels[side].filters,
			preamp: editing === 'both' || editing === side ? eqStore.preamp : preampOf(channels[side])
		});
		return { ...state('left'), right: state('right') };
	}

	/**
	 * The device is on no stored preset, and reads and writes reach its EQ there. Not while a preset
	 * is the target: they reach that preset then, not where the device is.
	 */
	get unsaved(): boolean {
		return this.deviceSlot === 'unsaved' && this.activeSlot === null;
	}

	get selection(): DeviceEqSelection {
		if (this.eqEnabled === false) return 'off';
		if (this.unsaved) return 'unsaved';
		const d = this.deviceSlot;
		if (typeof d === 'number' && this.slots.length > 0 && !this.#listed(d)) return 'other';
		if (this.eqEnabled === null && this.connection?.device.capabilities.canEnable) return null;
		return this.activeSlot;
	}

	#listed(slot: CurrentSlot): slot is number {
		return this.slots.some((s) => s.id === slot);
	}

	/**
	 * What reads and writes target on a device that is on `current`: that preset where it is listed;
	 * none on no preset, so they reach the EQ where it is; else (a built-in preset, or unknown) the
	 * first listed, or none on a device that lists none.
	 */
	#targetOf(current: CurrentSlot): number | null {
		if (current === 'unsaved') return null;
		return this.#listed(current) ? current : (this.slots[0]?.id ?? null);
	}

	/**
	 * `connection` as opened, edited as `eq` (the profile's own unless a reopen keeps another), with
	 * the listed EQs its mode lacks. `enabled` is that EQ's switch where the device reads one
	 * (`readsEnabled`); otherwise whether the EQ is on follows from the preset.
	 */
	setConnected(
		connection: DeviceConnection,
		currentSlot: CurrentSlot,
		enabled: boolean | null = null,
		deviceSlots: Slot[] | null = null,
		eq: EqTarget = OWN_EQ,
		absent: readonly string[] = []
	): void {
		// Unwritten changes carry over only to the same EQ of the same device: another's is read
		// regardless.
		const known = this.knownDevice;
		const same =
			known?.name === connection.name &&
			known.profile.id === connection.profile.id &&
			known.eq === eq.id;
		const carried = this.connection ? this.hasUnwritten : this.unwritten;
		this.unwritten = same && carried;
		this.#opened = { conn: connection, eq, absent };
		this.isConnecting = false;
		this.needsReconnect = false;
		this.controlValues = {};
		this.firmware = null;
		this.writeConsent = false;
		this.#newEq(currentSlot, enabled, deviceSlots);
	}

	/**
	 * Edit another of the connected device's EQs, read just now as a connect reads one; `gone` is
	 * one found missing from the device's mode, shown as absent from now on; `absent`, where the
	 * device was asked again, is every one its mode lacks now. The list's changes
	 * were settled before (written to the EQ left, or dropped), so nothing is unwritten. The
	 * controls and the volume warning's answer stay: they are the device's, not an EQ's.
	 */
	selectEq(
		eq: EqTarget,
		currentSlot: CurrentSlot,
		enabled: boolean | null,
		deviceSlots: Slot[] | null,
		gone?: string,
		absent: readonly string[] = this.absent
	): void {
		const opened = this.#opened;
		if (!opened) return;
		if (gone !== undefined && !absent.includes(gone)) absent = [...absent, gone];
		this.unwritten = false;
		this.#opened = { ...opened, eq, absent };
		this.#newEq(currentSlot, enabled, deviceSlots);
	}

	/**
	 * The EQ `connection` views is new: its presets and what it plays, and nothing known yet of
	 * what it holds. Auto-write starts over with it, a write that failed on another EQ included.
	 */
	#newEq(currentSlot: CurrentSlot, enabled: boolean | null, deviceSlots: Slot[] | null): void {
		const connection = this.connection!;
		this.deviceSlots = deviceSlots;
		this.knownDevice = { name: connection.name, profile: connection.profile, eq: this.eq };
		const bypass = connection.device.capabilities.slots.find((s) => s.bypass);
		// A device reading back its bypass preset has its EQ off, and no memory is selected.
		const onBypass = bypass !== undefined && currentSlot === bypass.id;
		this.deviceSlot = currentSlot;
		this.activeSlot = this.#targetOf(currentSlot);
		this.eqEnabled = enabled ?? (onBypass ? false : currentSlot !== null ? true : null);
		this.synced = null;
		this.#baseline = this.snapshot();
		this.layout = null;
		this.autoPaused = false;
		this.autoClipRisk = false;
		this.autoStopped = false;
		this.statusMessage = null;
		this.statusIsError = false;
	}

	/** The device was switched to `slot` (undefined: EQ on, no preset named) or its EQ off. */
	played(choice: number | 'off' | undefined): void {
		if (choice === 'off') {
			this.eqEnabled = false;
			const bypass = this.connection?.device.capabilities.slots.find((s) => s.bypass);
			if (bypass) this.deviceSlot = bypass.id;
			return;
		}
		// Back from a bypass preset or a built-in one: what it reads there may differ.
		if (choice !== this.deviceSlot) this.layout = null;
		this.eqEnabled = true;
		if (choice === undefined) return;
		this.deviceSlot = choice;
		this.target(choice);
	}

	/**
	 * The device said where it is when asked again (before a Read): it may have moved since, its own
	 * app's edit leaving its preset for none. The target follows it there, as a switch would, keeping
	 * the list's unwritten changes; unknown leaves things as they were.
	 */
	reported(current: CurrentSlot, enabled: boolean | null): void {
		if (enabled !== null) this.eqEnabled = enabled;
		if (current === null || current === this.deviceSlot) return;
		this.deviceSlot = current;
		this.layout = null;
		this.target(this.#targetOf(current));
	}

	/**
	 * Read and write `slot` from now on (null: no preset, the EQ where the device is). What the
	 * device held there is no longer known, and the last read or write's message ("Wrote 6 bands")
	 * was about another preset.
	 */
	target(slot: number | null): void {
		if (this.activeSlot === slot) return;
		this.unwritten = this.hasUnwritten;
		this.#baseline = this.snapshot();
		this.activeSlot = slot;
		this.synced = null;
		this.layout = null;
		this.autoPaused = false;
		this.setStatus(null);
	}

	/**
	 * The device's presets as it lists them now, after one was created or renamed, and what it
	 * plays. The target stays: its id still names the same preset.
	 */
	relisted(slots: Slot[], currentSlot: CurrentSlot, enabled: boolean | null): void {
		this.deviceSlots = slots;
		this.deviceSlot = currentSlot;
		if (enabled !== null) this.eqEnabled = enabled;
	}

	/**
	 * Preset `removed` was deleted: the ids after it moved down, and the device may have gone to
	 * another preset. Another preset deleted, the target keeps its own under its new id, and follows
	 * the device only if the device moved, as a switch would, keeping the list's unwritten changes.
	 * The target deleted, it is the preset the device went to, and whatever the list held for the
	 * deleted one has nowhere left to go. A target of no preset (the EQ where the device is) is
	 * never deleted. True when the target is another preset now.
	 */
	deleted(
		removed: number,
		slots: Slot[],
		currentSlot: CurrentSlot,
		enabled: boolean | null
	): boolean {
		const shift = <T extends CurrentSlot>(id: T) =>
			typeof id === 'number' && id > removed ? id - 1 : id;
		const moved = this.deviceSlot === removed || currentSlot !== shift(this.deviceSlot);
		const lost = this.activeSlot === removed;
		const kept = shift(this.activeSlot);
		this.relisted(slots, currentSlot, enabled);
		if (!lost) {
			this.activeSlot = kept;
			if (this.layout) this.layout = { ...this.layout, slot: kept };
			const went = moved && this.#listed(currentSlot) ? currentSlot : null;
			if (went === null || went === kept) return false;
			this.target(went);
			return true;
		}
		this.activeSlot = this.#targetOf(currentSlot);
		this.unwritten = false;
		this.#baseline = this.snapshot();
		this.synced = null;
		this.layout = null;
		this.autoPaused = false;
		return true;
	}

	/**
	 * The connection is gone. `knownDevice` stays, with the list read-only until it is back, and
	 * whether the list holds changes it never got.
	 */
	setDisconnected(): void {
		if (this.connection) this.unwritten = this.hasUnwritten;
		this.#baseline = null;
		eqStore.select(null);
		this.#opened = null;
		this.isConnecting = false;
		this.operation = null;
		this.deviceSlots = null;
		this.activeSlot = null;
		this.deviceSlot = null;
		this.eqEnabled = null;
		this.controlValues = {};
		this.firmware = null;
		this.synced = null;
		this.layout = null;
		this.autoPaused = false;
		this.autoClipRisk = false;
		this.autoStopped = false;
		this.writeConsent = false;
		this.statusMessage = null;
		this.statusIsError = false;
		this.needsReconnect = false;
	}

	/** Back to before any device: disconnected, and no device to edit for. */
	forget(): void {
		this.setDisconnected();
		this.knownDevice = null;
		this.unwritten = false;
	}

	setStatus(message: string | null, isError = false): void {
		this.statusMessage = message;
		this.statusIsError = message !== null && isError;
		if (!this.statusIsError) this.failure = null;
	}
}

export const devicePeqStore = new DevicePeqStore();
