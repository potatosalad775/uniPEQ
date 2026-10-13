// Adapted from modernGraphTool src/lib/stores/device-peq-store.svelte.ts @ 23ddc4dd: no separate
// constraint store (the connected profile is the constraint), and writable presets.
/**
 * The connected EQ device and what the app is doing with it.
 *
 * The connection's eqcaps profile is the active constraint while it lasts (`profile`). The device's
 * EQ is what the list edits: it is read on connecting unless the list holds changes
 * the device never got (`unwritten`), and it can't be edited while disconnected (`canEdit`). Bands
 * that don't fit are flagged, never refitted: Fit is the user's call.
 */
import { readRequest, writeRequest, type PresetRequest } from '$lib/device-peq/preset';
import type { DeviceConnection, PeqCapabilities } from '$lib/device-peq/types';
import { eqFiltersEqual, type EqFilter } from '$lib/eq/model';
import type { Filter, Profile } from '@potatosalad775/eqcaps-core';
import type { Slot } from '@potatosalad775/eqcaps-device-bridge';
import { eqStore } from './eq-store.svelte';

/**
 * What the Device EQ control shows: a listed preset (by id), the EQ off, a preset the device is
 * on that isn't listed (a built-in one), or null when the device can't say.
 */
export type DeviceEqSelection = number | 'off' | 'other' | null;

/** The band list and preamp as they were when last read from or written to the device. */
export interface DeviceSnapshot {
	filters: EqFilter[];
	preamp: number;
}

class DevicePeqStore {
	connection = $state.raw<DeviceConnection | null>(null);
	/**
	 * The device the EQ is edited for: the connected one, or after a disconnect the
	 * last one, so a dropped cable doesn't take the editor with it. Null until a first connection:
	 * the EQ tab then asks for a device.
	 */
	knownDevice = $state.raw<{ name: string; profile: Profile } | null>(null);
	isConnecting = $state(false);
	isReading = $state(false);
	isWriting = $state(false);
	isSwitching = $state(false);
	/** The listed preset reads and writes target; null when the device lists none. */
	activeSlot = $state<number | null>(null);
	/**
	 * The preset the device is on, as it last reported or was told: may be unlisted (a built-in
	 * preset) or the bypass preset. Null when unknown. Protocols that only read and write the
	 * current preset can reach `activeSlot` only while this equals it.
	 */
	deviceSlot = $state<number | null>(null);
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
	layout = $state.raw<{ slot: number | null; hints: (Filter | null)[] | null } | null>(null);
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

	get isConnected(): boolean {
		return this.connection !== null;
	}

	/**
	 * The list can be edited: a device is connected and reachable. Disconnected, the
	 * list stays on screen read-only, to look at or save as a preset.
	 */
	get canEdit(): boolean {
		return this.connection !== null && !this.needsReconnect;
	}

	get isBusy(): boolean {
		return this.isConnecting || this.isReading || this.isWriting || this.isSwitching;
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

	/** The protocol is unconfirmed for this device (a guessed one, or flagged in eqcaps). */
	get experimental(): boolean {
		const c = this.connection;
		return !!c && (c.device.capabilities.experimental || c.profileSource === 'guess');
	}

	/** EQ memories to read from and write to — the bypass preset is the off switch, not one. */
	get slots(): Slot[] {
		return (this.connection?.device.capabilities.slots ?? []).filter((s) => !s.bypass);
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

	/** Whether the target preset is one the user may write; true for a device without presets. */
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

	/** The list and preamp equal `snapshot` (the preamp only where the device takes one). */
	#holds(snapshot: DeviceSnapshot): boolean {
		const preampMatters = this.connection?.device.capabilities.writesPreamp ?? false;
		return (
			snapshot.filters.length === eqStore.filters.length &&
			snapshot.filters.every((f, i) => eqFiltersEqual(f, eqStore.filters[i])) &&
			(!preampMatters || snapshot.preamp === eqStore.preamp)
		);
	}

	#snapshot(): DeviceSnapshot {
		return { filters: eqStore.filters, preamp: eqStore.preamp };
	}

	get selection(): DeviceEqSelection {
		if (this.eqEnabled === false) return 'off';
		const d = this.deviceSlot;
		if (d !== null && this.slots.length > 0 && !this.slots.some((s) => s.id === d)) return 'other';
		if (this.eqEnabled === null && this.connection?.device.capabilities.canEnable) return null;
		return this.activeSlot;
	}

	setConnected(connection: DeviceConnection, currentSlot: number | null): void {
		// Unwritten changes carry over only to the same device: another one's EQ is read regardless.
		const known = this.knownDevice;
		const same = known?.name === connection.name && known.profile.id === connection.profile.id;
		const carried = this.connection ? this.hasUnwritten : this.unwritten;
		this.unwritten = same && carried;
		this.connection = connection;
		this.knownDevice = { name: connection.name, profile: connection.profile };
		this.isConnecting = false;
		this.needsReconnect = false;
		const bypass = connection.device.capabilities.slots.find((s) => s.bypass);
		// A device reading back its bypass preset has its EQ off, and no memory is selected.
		const onBypass = bypass !== undefined && currentSlot === bypass.id;
		const listed = this.slots.some((s) => s.id === currentSlot);
		this.deviceSlot = currentSlot;
		this.activeSlot = listed ? currentSlot : (this.slots[0]?.id ?? null);
		this.eqEnabled = onBypass ? false : currentSlot !== null ? true : null;
		this.synced = null;
		this.#baseline = this.#snapshot();
		this.layout = null;
		this.autoPaused = false;
		this.autoClipRisk = false;
		this.autoStopped = false;
		this.writeConsent = false;
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
	 * Read and write `slot` from now on. What the device held there is no longer known, and the last
	 * read or write's message ("Wrote 6 bands") was about another preset.
	 */
	target(slot: number): void {
		if (this.activeSlot === slot) return;
		this.unwritten = this.hasUnwritten;
		this.#baseline = this.#snapshot();
		this.activeSlot = slot;
		this.synced = null;
		this.layout = null;
		this.autoPaused = false;
		this.setStatus(null);
	}

	/**
	 * The connection is gone. `knownDevice` stays, with the list read-only until it is back, and
	 * whether the list holds changes it never got.
	 */
	setDisconnected(): void {
		if (this.connection) this.unwritten = this.hasUnwritten;
		this.#baseline = null;
		eqStore.select(null);
		this.connection = null;
		this.isConnecting = false;
		this.isReading = false;
		this.isWriting = false;
		this.isSwitching = false;
		this.activeSlot = null;
		this.deviceSlot = null;
		this.eqEnabled = null;
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
