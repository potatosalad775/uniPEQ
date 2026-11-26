/**
 * uniPEQ's side of the modernGraphTool link: joins the room the user picked (an intent link, the
 * QR code's App Link or a typed code), asks for approval, then owns the shared band list and is the
 * only side that writes the device. The protocol is the reference client's (`peq-link/client`);
 * this binds its handlers to the stores and its events to the UI.
 *
 * - Edits apply through `eqStore`, one undo step per burst, a band projected onto its slot as a
 *   local edit is. Nothing applies while the list can't be edited.
 * - What a modernGraphTool before protocol 1.3 can't be told stays as it was for it (`minor`): one
 *   list, the channel on screen. From 1.3 it gets both channels, the device's EQs, its settings
 *   and its presets as they are now; 1.4 adds the EQs' names.
 * - Device work runs in the handler of the message that asked for it (`settle`, a command), never
 *   behind a timer: in Doze a message wakes the CPU and a timer doesn't. Each command holds a wake
 *   lock while it runs.
 * - While linked (Android), the foreground service and keep-visible run, and the self-check
 *   reports when Android paused uniPEQ anyway.
 *
 * Reached through dynamic `import()` (`loadLinkService`), so the link client stays out of the boot
 * bundle.
 */
import { App } from '@capacitor/app';
import { flushSync, untrack } from 'svelte';
import {
	FILTER_TYPES,
	formatRoomCode,
	parseRoomInput,
	PROTO,
	startJoiner,
	WEB_LINK_PARAM,
	type ApprovalRequest,
	type CommandArgs,
	type CommandName,
	type CommandResult,
	type EditOp,
	type Ended,
	type Filter,
	type JoinerLink,
	type LinkChannel,
	type LinkDevice,
	type LinkEq,
	type LinkStatus,
	type PlanChange
} from 'peq-link/client';
import type { PushPlan } from '#lib/device-peq/push-plan.js';
import { assignSlots, editFilter, fitFilters, sameFilters } from '#lib/eq/eq-constraint.js';
import { preampOf } from '#lib/eq/eq-preamp.js';
import {
	eqFiltersEqual,
	type Channel,
	type ChannelEq,
	type EqFilter,
	type FilterType
} from '#lib/eq/model.js';
import * as m from '#lib/paraglide/messages.js';
import { appState } from '#lib/platform/app-state.svelte.js';
import {
	backgroundRestricted,
	onNativeUnlink,
	startLinkService,
	stopLinkService,
	updateLinkService,
	whileAwake
} from '#lib/platform/link.js';
import { isNative } from '#lib/platform/native.js';
import { devicePeqService } from '#lib/services/device-peq-service.svelte.js';
import { logger } from '#lib/services/logger.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqConstraintStore } from '#lib/stores/eq-constraint-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import { noticeStore } from '#lib/stores/notice-store.svelte.js';
import { CRASH_MARKER_KEY, linkStore } from './link-store.svelte';
import { startSelfCheck } from './self-check';

/** uniPEQ's server. A typed code joins it; another one is named in the approval dialog. */
export const DEFAULT_SERVER = 'https://link.unipeq.com';

/** After this long without an open channel, the browser has to come back to the front. */
const GO_BACK_MS = 5_000;

/** The protocol minor that brought the channels apart, the device's EQs, settings and presets. */
const DEVICE_MINOR = 3;

function channelOf(channel: ChannelEq): LinkChannel {
	return {
		filters: channel.filters,
		// As written: Auto's on the device's grid.
		preamp: eqConstraintStore.preampValueOf(channel),
		autoPreamp: channel.autoPreamp
	};
}

/**
 * The list on screen. Its preamp is the store's own, worked out once per edit: a snapshot is taken
 * on every frame of a drag.
 */
function shown(): LinkChannel {
	return {
		filters: eqStore.filters,
		preamp: eqConstraintStore.preampValue,
		autoPreamp: eqStore.autoPreamp
	};
}

/**
 * The shared list. `apart`: modernGraphTool knows two channels (protocol 1.3), so with them apart
 * it gets both. An older one has one list, the channel on screen, which is where its edits land.
 */
function snapshot(apart: boolean): LinkEq {
	if (apart && !eqStore.linked) {
		const { channels, editing } = eqStore;
		const of = (side: Channel) => (editing === side ? shown() : channelOf(channels[side]));
		return { ...of('left'), right: of('right') };
	}
	return shown();
}

function sameChannel(a: LinkChannel, b: LinkChannel): boolean {
	return a.filters === b.filters && a.preamp === b.preamp && a.autoPreamp === b.autoPreamp;
}

function same(a: LinkEq, b: LinkEq): boolean {
	if (!sameChannel(a, b)) return false;
	if (!a.right || !b.right) return a.right === b.right;
	return sameChannel(a.right, b.right);
}

/** `squig.link`: the attested origin's host, never mGT's own claim of its name. */
function hostOf(origin: string): string {
	try {
		return new URL(origin).host || origin;
	} catch {
		return origin;
	}
}

function linkDevice(): LinkDevice | null {
	const conn = devicePeqStore.connection;
	if (!conn) return null;
	const c = conn.device.capabilities;
	return {
		// Protocol 1.3: which of `capabilities.eqs` this is. An older modernGraphTool ignores it.
		eq: devicePeqStore.eq ?? null,
		// Protocol 1.4: the device's EQs by name, which the viewed EQ's profile drops. Whether each
		// is there now is `status.absentEqs`.
		eqs: devicePeqStore.eqs.map(({ id, name }) => ({ id: id ?? null, name: name ?? null })),
		name: conn.name,
		kind: conn.profileSource === 'demo' ? 'demo' : conn.connectionType,
		profile: conn.profile,
		profileSource: conn.profileSource,
		profileId: conn.profileId,
		identity: conn.identity,
		capabilities: {
			canRead: c.canRead,
			canWrite: c.canWrite,
			readsPreamp: c.readsPreamp,
			readsSlot: c.readsSlot,
			writesPreamp: c.writesPreamp,
			writesSlot: c.writesSlot,
			readsCurrentSlot: c.readsCurrentSlot,
			canEnable: c.canEnable,
			slots: c.slots,
			disconnectOnSave: c.disconnectOnSave,
			experimental: c.experimental,
			// Protocol 1.3. The values and the live lists are in `status`.
			controls: c.controls,
			eqs: c.eqs,
			// Whether the channels may be set apart, as uniPEQ allows it: the profile says so too.
			perChannel: devicePeqStore.perChannel,
			listsSlots: c.listsSlots,
			editsSlots: c.editsSlots,
			readsBandCount: c.readsBandCount
		}
	};
}

function deviceName(): string | null {
	return devicePeqStore.connection?.name ?? devicePeqStore.knownDevice?.name ?? null;
}

/** A device command: its effects reach mGT as `eq`, `status` and `device`; `re` says if it failed. */
async function deviceCommand(work: () => Promise<unknown>): Promise<CommandResult> {
	if (!devicePeqStore.connection) return { ok: false, code: 'no-device' };
	// One at a time: an operation or a reconnect under way would refuse this one without a word.
	if (devicePeqStore.isBusy) return { ok: false, code: 'busy' };
	const before = devicePeqStore.failure;
	await whileAwake(work);
	const failure = devicePeqStore.failure;
	return failure && failure !== before ? { ok: false, code: failure.code } : { ok: true };
}

/**
 * The device's presets can be added to, renamed and deleted from here: as in uniPEQ, which
 * offers them only while the device can be reached.
 */
function presetsEditable(): CommandResult | null {
	if (!devicePeqStore.connection) return { ok: false, code: 'no-device' };
	if (!devicePeqStore.canEditPresets) return { ok: false, code: 'unsupported' };
	return devicePeqStore.canEdit ? null : { ok: false, code: 'not-editable' };
}

/** A command's args as mGT sent them: the client passes them on unchecked. */
function argsOf(args: unknown): Record<string, unknown> {
	return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
}

/** One room joined: from asking for approval to the end. */
class Session {
	readonly link: JoinerLink;
	readonly server: string;
	readonly room: string;
	host: string | null = null;
	/** The channel opened at least once. */
	opened = false;
	/** Mirrors the client's `rev`: bumped on every change it numbers. */
	#rev = 0;
	/** The list after mGT's last edit, which mustn't go back to mGT as uniPEQ's own. */
	#applied: LinkEq | null = null;
	/** What the effect last saw of the list, and the fresh starts it counted. */
	#seen: LinkEq | null = null;
	#epoch = 0;
	/** mGT's `hello`s: each settles `minor` again, which the effect follows but can't track. */
	#hellos = $state(0);
	/** mGT edits without a burst are one undo step each. */
	#unbursted = 0;
	/** The review mGT is shown, with the `rev` it was planned at. */
	#review: { plan: PushPlan; rev: number } | null = null;
	#dispose: (() => void)[] = [];
	#watching = false;

	/** `launch` is the token of a link modernGraphTool opened itself, echoed back in `hello`. */
	constructor(server: string, room: string, events: SessionEvents, launch?: string) {
		this.server = server;
		this.room = room;
		this.link = startJoiner({
			server,
			room,
			launch,
			version: __APP_VERSION__,
			defaultServer: DEFAULT_SERVER,
			foreground: appState.active,
			handlers: {
				eq: () => this.#snapshot(),
				device: linkDevice,
				status: () => this.#status(),
				edit: (ops, meta) => this.#edit(ops, meta),
				command: (name, args) => this.#command(name, args)
			}
		});
		this.link.session.on('open', () => {
			this.opened = true;
			events.changed();
		});
		this.link.on('state', () => events.changed());
		// The list's shape follows `minor`: the effect starts over from the new one, rather than
		// count the shape changing as an edit. The client sends mGT the list itself.
		this.link.on('hello', () => {
			this.#seen = null;
			this.#hellos++;
		});
		this.link.on('request', (request) => {
			this.host = hostOf(request.host.origin);
			events.request(this, request);
		});
		this.link.on('ended', (ended) => {
			this.stop();
			events.ended(this, ended);
		});
	}

	/** Approved: start broadcasting uniPEQ's changes. Again after a re-ask, a no-op. */
	watch(): void {
		if (this.#watching) return;
		this.#watching = true;
		this.#dispose.push(
			$effect.root(() => {
				$effect(() => {
					void this.#hellos;
					const now = this.#snapshot();
					const step = eqStore.step;
					const epoch = eqStore.epoch;
					untrack(() => this.#localChange(now, step, epoch));
				});
				let device = devicePeqStore.connection;
				$effect(() => {
					const now = devicePeqStore.connection;
					const name = deviceName();
					untrack(() => {
						if (now !== device) this.link.sendDevice();
						device = now;
						if (this.host) updateLinkService(this.host, name);
					});
				});
				let sent = JSON.stringify(this.#status());
				$effect(() => {
					const json = JSON.stringify(this.#status());
					untrack(() => {
						if (json === sent) return;
						sent = json;
						this.link.sendStatus();
					});
				});
			})
		);
	}

	stop(): void {
		for (const dispose of this.#dispose.splice(0)) dispose();
	}

	/** modernGraphTool knows what protocol 1.3 added. False until its `hello` says so. */
	get #device(): boolean {
		return this.link.minor >= DEVICE_MINOR;
	}

	#snapshot(): LinkEq {
		return snapshot(this.#device);
	}

	#localChange(now: LinkEq, step: number, epoch: number): void {
		const last = this.#seen;
		this.#seen = now;
		const fresh = epoch !== this.#epoch;
		this.#epoch = epoch;
		if (!last || same(last, now)) return;
		if (this.#applied && same(this.#applied, now)) {
			this.#applied = null;
			return;
		}
		if (!this.link.approved) return;
		this.#rev++;
		// A read on connecting or switching presets is an undo barrier in mGT too.
		this.link.changed(fresh ? { by: 'device', fresh: true } : { by: 'unipeq', burst: `u${step}` });
	}

	#edit(ops: EditOp[], meta: { burst?: string; settle: boolean }): boolean {
		if (!eqConstraintStore.editable) return false;
		const key = `link:${meta.burst ?? `#${++this.#unbursted}`}`;
		const before = this.#snapshot();
		// One list, as before 1.3, takes each op as a local edit of it. Two channels, or an op that
		// names one or sets them apart, are worked out whole and loaded as one step.
		const channels =
			this.#device && (!eqStore.linked || ops.some((op) => 'ch' in op || op.op === 'channels'));
		if (channels) applyChannels(ops, key);
		else for (const op of ops) applyOp(op, key);
		const after = this.#snapshot();
		const changed = !same(before, after);
		if (changed) {
			this.#applied = after;
			this.#rev++;
		}
		if (meta.settle) {
			// Let the auto-writer see the edit, then write now, from this message's handler.
			flushSync();
			void whileAwake(() => devicePeqService.writeNow());
		}
		return changed;
	}

	async #command<N extends CommandName>(name: N, args: CommandArgs[N]): Promise<CommandResult> {
		switch (name) {
			case 'read':
				return deviceCommand(() => devicePeqService.read());
			case 'write':
				return deviceCommand(() => devicePeqService.requestWrite());
			case 'review': {
				const { rev, accept } = args as CommandArgs['review'];
				const review = this.#reviewShown();
				if (!review) return { ok: false, code: 'no-review' };
				if (!accept) {
					await devicePeqService.confirmReview(false);
					return { ok: true };
				}
				// mGT answered a plan it no longer shows: plan again rather than write what it didn't see.
				// A list that moved since the plan is planned again by confirmReview itself.
				if (rev !== review.rev) {
					devicePeqService.review = null;
					return deviceCommand(() => devicePeqService.requestWrite());
				}
				return deviceCommand(() => devicePeqService.confirmReview(true));
			}
			case 'switch':
				return deviceCommand(() =>
					devicePeqService.switchTo((args as CommandArgs['switch']).value)
				);
			case 'fit': {
				if (!eqConstraintStore.editable) return { ok: false, code: 'not-editable' };
				// mGT shows both channels apart, and not which one is on screen here: it fits both.
				if (this.#device && !eqStore.linked) {
					fitChannels();
					return { ok: true };
				}
				const next = eqConstraintStore.fitted;
				if (next) eqStore.replace(next);
				return { ok: true };
			}
			case 'reconnect':
				if (devicePeqStore.connection) return deviceCommand(() => devicePeqService.reconnect());
				// A dropped USB device: Android finds it again without a chooser. The browser's
				// chooser needs a click in uniPEQ.
				if (!isNative || !devicePeqStore.knownDevice) return { ok: false, code: 'unsupported' };
				return whileAwake(async () => {
					await devicePeqService.connect('hid');
					return devicePeqStore.connection
						? { ok: true }
						: { ok: false, code: devicePeqStore.failure?.code ?? 'no-device' };
				});
			case 'auto-write':
				devicePeqService.setAutoWrite((args as CommandArgs['auto-write']).on);
				return { ok: true };
			case 'consent': {
				if (!devicePeqService.volumeWarning) return { ok: false, code: 'no-consent' };
				const { accept, quiet } = args as CommandArgs['consent'];
				// Going on runs what waited (a Write, a switch): device work, so awake.
				return deviceCommand(() => devicePeqService.answerVolumeWarning(accept, quiet));
			}
			case 'eq': {
				const store = devicePeqStore;
				const raw = argsOf(args).id;
				const id = typeof raw === 'string' ? raw : undefined;
				if (raw != null && id === undefined) return { ok: false, code: 'invalid-request' };
				if (!store.connection) return { ok: false, code: 'no-device' };
				if (id === store.eq) return { ok: true };
				const target = store.eqs.find((e) => e.id === id);
				if (!target) return { ok: false, code: 'invalid-request' };
				if (!target.present) return { ok: false, code: 'unsupported' };
				if (!store.canEdit) return { ok: false, code: 'not-editable' };
				if (store.isBusy) return { ok: false, code: 'busy' };
				return whileAwake(async (): Promise<CommandResult> => {
					if (store.autoDueAt !== null) await devicePeqService.writeNow();
					// uniPEQ asks here what to do with them (write, discard). modernGraphTool can't
					// answer that dialog, so it is told why and writes or reads first.
					if (store.hasUnwritten) return { ok: false, code: 'unwritten' };
					const before = store.failure;
					await devicePeqService.selectEq(id);
					const failure = store.failure;
					if (failure && failure !== before) return { ok: false, code: failure.code };
					// The device's mode turned out to lack it: uniPEQ is on the device's own EQ.
					return store.eq === id ? { ok: true } : { ok: false, code: 'unsupported' };
				});
			}
			case 'control': {
				const { id, value } = argsOf(args);
				const controls = devicePeqStore.capabilities?.controls ?? [];
				if (!devicePeqStore.connection) return { ok: false, code: 'no-device' };
				if (
					typeof id !== 'string' ||
					typeof value !== 'number' ||
					!controls.some((c) => c.id === id)
				)
					return { ok: false, code: 'invalid-request' };
				// As in uniPEQ, which offers the device's settings only while it can be reached.
				if (!devicePeqStore.canEdit) return { ok: false, code: 'not-editable' };
				return deviceCommand(() => devicePeqService.setControl(id, value));
			}
			case 'preset-create': {
				const refused = presetsEditable();
				if (refused) return refused;
				const store = devicePeqStore;
				const room = store.slotRoom;
				if (room !== null && store.slots.length >= room) return { ok: false, code: 'rejected' };
				const { name } = argsOf(args);
				if (name !== undefined && typeof name !== 'string')
					return { ok: false, code: 'invalid-request' };
				const had = new Set(store.slots.map((s) => s.id));
				const result = await deviceCommand(() => devicePeqService.createPreset(name));
				// Made, it stands, whatever failed after it (the switch to it, a read): that is in
				// `status`, and mGT asking again would make another.
				return store.slots.some((s) => !had.has(s.id)) ? { ok: true } : result;
			}
			case 'preset-rename': {
				const refused = presetsEditable();
				if (refused) return refused;
				const { slot, name } = argsOf(args);
				// A blank name too: uniPEQ's own Rename takes none.
				if (typeof name !== 'string' || !name.trim()) return { ok: false, code: 'invalid-request' };
				const known = devicePeqStore.slots.find((s) => s.id === slot);
				if (!known) return { ok: false, code: 'invalid-request' };
				return deviceCommand(() => devicePeqService.renamePreset(known.id, name));
			}
			case 'preset-delete': {
				const refused = presetsEditable();
				if (refused) return refused;
				const { slot } = argsOf(args);
				const slots = devicePeqStore.slots;
				const known = slots.find((s) => s.id === slot);
				// The last one stays: a device with a list plays one of them.
				if (slots.length <= 1 || !known) return { ok: false, code: 'invalid-request' };
				return deviceCommand(() => devicePeqService.deletePreset(known.id));
			}
			default:
				return { ok: false, code: 'unsupported' };
		}
	}

	/** The review open now, with the `rev` it was planned at. */
	#reviewShown(): { plan: PushPlan; rev: number } | null {
		const plan = devicePeqService.review;
		if (!plan) return (this.#review = null);
		if (this.#review?.plan !== plan) this.#review = { plan, rev: this.#rev };
		return this.#review;
	}

	#status(): LinkStatus {
		const store = devicePeqStore;
		const review = this.#reviewShown();
		return {
			connected: store.connection !== null,
			knownDevice: store.knownDevice?.name ?? null,
			editable: eqConstraintStore.editable,
			activeSlot: store.activeSlot,
			// A device on no preset is `unsaved` (1.3); before it, unknown.
			deviceSlot: typeof store.deviceSlot === 'number' ? store.deviceSlot : null,
			unsaved: store.deviceSlot === 'unsaved',
			eqEnabled: store.eqEnabled,
			// `control` and `preset` are 1.3's: the client sends an older modernGraphTool null.
			busy: store.isConnecting ? 'connect' : store.operation === 'eq' ? 'switch' : store.operation,
			// The presets as they are now, where the device keeps the list (1.3).
			...(store.deviceSlots ? { slots: store.deviceSlots } : {}),
			absentEqs: [...store.absent],
			controls: store.controlValues,
			inSync: store.inSync,
			unwritten: store.unwritten,
			needsReconnect: store.needsReconnect,
			auto: {
				on: devicePeqService.autoWriteOn,
				pending: store.autoDueAt !== null,
				paused: store.autoPaused,
				stopped: store.autoStopped,
				clipRisk: store.autoClipRisk
			},
			failure: store.failure,
			consent: devicePeqService.volumeWarning,
			review: review && {
				rev: review.rev,
				changes: review.plan.changes satisfies PlanChange[],
				clipRisk: review.plan.clipRisk,
				infeasible: review.plan.infeasible
			}
		};
	}
}

/** A band from mGT, or null for a type uniPEQ doesn't edit (an `x-` type from a device). */
function bandOf({ type, freq, q, gain }: Filter): EqFilter | null {
	const known = (FILTER_TYPES as readonly string[]).includes(type);
	return known ? { type: type as FilterType, freq, q, gain } : null;
}

/** One of mGT's ops, through the EQ store under the burst's coalesce key. */
function applyOp(op: EditOp, key: string): void {
	switch (op.op) {
		case 'band': {
			const current = eqStore.filters[op.i];
			const filter = bandOf(op.filter);
			// Past the end, the list changed shape under it; an `x-` type isn't one uniPEQ edits.
			if (!current || !filter) return;
			const slot = eqConstraintStore.slots[op.i] ?? op.i;
			eqStore.update(op.i, editFilter(current, filter, eqConstraintStore.profile, slot), key);
			return;
		}
		case 'list': {
			// Like a loaded preset: taken as it is, flagged where it doesn't fit. Fit is the user's call.
			const filters = op.filters.map(bandOf).filter((f) => f !== null);
			eqStore.replace(filters, undefined, key);
			return;
		}
		case 'preamp':
			eqStore.setPreamp(op.db, key);
			return;
		case 'auto-preamp':
			eqStore.setAutoPreamp(op.on, key);
			return;
	}
}

/** `channel` with band `i` as modernGraphTool set it, projected onto its slot as a local edit is. */
function withBand(channel: ChannelEq, i: number, to: Filter): ChannelEq {
	const current = channel.filters[i];
	const filter = bandOf(to);
	if (!current || !filter) return channel;
	const profile = eqConstraintStore.profile;
	const slot = assignSlots(channel.filters, profile)[i] ?? i;
	const next = { ...current, ...editFilter(current, filter, profile, slot) };
	// Unchanged, it is no edit and no undo step, as `eqStore.update` has it.
	if (eqFiltersEqual(current, next)) return channel;
	return { ...channel, filters: channel.filters.with(i, next) };
}

/** A channel's preamp as `eqStore.load` takes it. */
function pregainOf(c: ChannelEq): number | 'auto' {
	return c.autoPreamp ? 'auto' : c.manualPreamp;
}

/** Fit for both channels apart, as one undo step: the channel on screen stays on screen. */
function fitChannels(): void {
	const { profile } = eqConstraintStore;
	const { left, right } = eqStore.channels;
	const fitLeft = fitFilters(left.filters, profile);
	const fitRight = fitFilters(right.filters, profile);
	if (sameFilters(fitLeft, left.filters) && sameFilters(fitRight, right.filters)) return;
	eqStore.load({
		filters: fitLeft,
		preamp: pregainOf(left),
		right: { filters: fitRight, preamp: pregainOf(right) }
	});
}

/**
 * modernGraphTool's ops where the channels are apart or an op says which one (protocol 1.3), as
 * the client's `applyOps` defines them: without `ch` an op sets both channels, with it that one,
 * and it is dropped while one list drives both. Worked out whole and loaded once, since the store
 * edits only the channel on screen; the one on screen stays on screen.
 */
function applyChannels(ops: EditOp[], key: string): void {
	const was = eqStore.channels;
	const wasApart = !eqStore.linked;
	let { left, right } = was;
	let apart = wasApart;
	const set = (ch: 'left' | 'right' | undefined, change: (c: ChannelEq) => ChannelEq): void => {
		if (ch !== undefined && !apart) return;
		if (ch !== 'right') left = change(left);
		if (!apart) right = left;
		else if (ch !== 'left') right = change(right);
	};
	for (const op of ops) {
		switch (op.op) {
			case 'band':
				set(op.ch, (c) => withBand(c, op.i, op.filter));
				break;
			case 'list': {
				const filters = op.filters.map(bandOf).filter((f) => f !== null);
				set(op.ch, (c) => ({ ...c, filters }));
				break;
			}
			case 'preamp':
				set(op.ch, (c) =>
					!c.autoPreamp && c.manualPreamp === op.db
						? c
						: { filters: c.filters, autoPreamp: false, manualPreamp: op.db }
				);
				break;
			case 'auto-preamp':
				// Off, it stays where it was, as `eqStore.setAutoPreamp` leaves it.
				set(op.ch, (c) =>
					c.autoPreamp === op.on
						? c
						: { filters: c.filters, autoPreamp: op.on, manualPreamp: preampOf(c) }
				);
				break;
			case 'channels':
				if (op.apart) {
					// Only a device that drives its channels apart may hold them apart.
					if (!apart && devicePeqStore.perChannel) apart = true;
				} else if (apart) {
					if (op.keep === 'right') left = right;
					else right = left;
					apart = false;
				}
				break;
		}
	}
	if (left === was.left && right === was.right && apart === wasApart) return;
	eqStore.load(
		{
			filters: left.filters,
			preamp: pregainOf(left),
			...(apart ? { right: { filters: right.filters, preamp: pregainOf(right) } } : {})
		},
		key
	);
}

interface SessionEvents {
	changed(): void;
	request(session: Session, request: ApprovalRequest): void;
	ended(session: Session, ended: Ended): void;
}

class LinkService {
	/** The approved session. */
	#linked: Session | null = null;
	/** A session asking for approval: a first link, or one that would replace `#linked`. */
	#pending: Session | null = null;
	/** The session the open approval dialog is about. */
	#asking: Session | null = null;
	#stopSelfCheck: (() => void) | null = null;
	#goBackTimer: ReturnType<typeof setTimeout> | undefined;
	#installed = false;

	readonly #events: SessionEvents = {
		changed: () => this.#sync(),
		request: (session, request) => {
			this.#asking = session;
			const replaces = session === this.#pending ? (this.#linked?.host ?? null) : null;
			const host = session.host ?? hostOf(request.host.origin);
			linkStore.approval = { request, host, replaces };
			this.#sync();
		},
		ended: (session, ended) => this.#ended(session, ended)
	};

	/** Page-lifetime. Android: the launch URL and later ones, the notification's Unlink. */
	install(): void {
		if (this.#installed) return;
		this.#installed = true;
		appState.on((active) => {
			this.#linked?.link.setForeground(active);
			this.#pending?.link.setForeground(active);
		});
		if (!isNative) return;
		onNativeUnlink(() => this.unlink());
		// A session that never ended: Android killed uniPEQ while it was linked.
		try {
			if (localStorage.getItem(CRASH_MARKER_KEY)) {
				localStorage.removeItem(CRASH_MARKER_KEY);
				linkStore.tip();
			}
		} catch {
			// No storage, no marker.
		}
		void App.addListener('appUrlOpen', ({ url }) => this.open(url));
		void App.getLaunchUrl()
			.then((launch) => launch?.url && this.open(launch.url))
			.catch(() => {});
	}

	/**
	 * A code, a landing URL or `unipeq://link?…`: joins its room and asks. False when it's none of
	 * those. Joining doesn't wait for the user, so the channel opens within the 5 s phone Chrome
	 * keeps its network after the user leaves it.
	 */
	open(input: string): boolean {
		const target = parseRoomInput(input, DEFAULT_SERVER);
		if (!target) return false;
		const known = [this.#linked, this.#pending].find(
			(s) => s && s.room === target.room && s.server === target.server
		);
		if (known) return true;
		// The newest link the user opened wins over one still asking.
		if (this.#pending && this.#asking === this.#pending) {
			this.#asking = null;
			linkStore.approval = null;
		}
		this.#pending?.link.deny();
		logger.info(`link: joining ${formatRoomCode(target.room)} on ${hostOf(target.server)}`);
		this.#pending = new Session(target.server, target.room, this.#events, target.launch);
		clearTimeout(this.#goBackTimer);
		this.#goBackTimer = setTimeout(() => this.#sync(true), GO_BACK_MS);
		this.#sync();
		return true;
	}

	/**
	 * uniPEQ on the web, opened by modernGraphTool's "Open uniPEQ" (`webLink`): the room is in the
	 * address. Joins it, and returns the address without it, so a reload doesn't join again; null
	 * when the address holds no link.
	 */
	openAddress(href: string): URL | null {
		const url = new URL(href);
		const link = url.searchParams.get(WEB_LINK_PARAM);
		if (link === null) return null;
		url.searchParams.delete(WEB_LINK_PARAM);
		this.open(link);
		return url;
	}

	/** "Link": starts the link service and keep-visible (Android), then the shared list. */
	approve(): void {
		const session = this.#asking;
		linkStore.approval = null;
		this.#asking = null;
		if (!session) return;
		session.link.approve();
		session.watch();
		// A re-ask (mGT came back as a new page) keeps what the first approval started.
		if (session !== this.#pending) return this.#sync();
		this.#pending = null;
		this.#linked?.link.close('replaced');
		this.#linked = session;
		startLinkService(session.host ?? hostOf(session.server), deviceName());
		try {
			localStorage.setItem(
				CRASH_MARKER_KEY,
				JSON.stringify({ room: session.room, since: Date.now() })
			);
		} catch {
			// The self-check then just can't tell a crash afterwards.
		}
		if (isNative && !this.#stopSelfCheck) {
			this.#stopSelfCheck = startSelfCheck((cause, ms) => {
				logger.warn(`link: paused ${Math.round(ms / 1000)} s (${cause})`);
				this.#linked?.link.notice(cause, ms);
				linkStore.tip();
			});
		}
		void backgroundRestricted().then((restricted) => restricted && linkStore.tip());
		this.#sync();
	}

	/** "Don't link". */
	deny(): void {
		const session = this.#asking;
		linkStore.approval = null;
		this.#asking = null;
		session?.link.deny();
		this.#sync();
	}

	/** Unlink, or cancel a link still joining. */
	unlink(): void {
		this.#pending?.link.close('unlink');
		this.#linked?.link.close('unlink');
	}

	#ended(session: Session, ended: Ended): void {
		logger.info(`link: ended (${ended.reason}, by ${ended.by})`);
		if (session === this.#asking) {
			this.#asking = null;
			linkStore.approval = null;
		}
		if (session === this.#pending) this.#pending = null;
		if (session === this.#linked) {
			this.#linked = null;
			stopLinkService();
			this.#stopSelfCheck?.();
			this.#stopSelfCheck = null;
			try {
				localStorage.removeItem(CRASH_MARKER_KEY);
			} catch {
				// Nothing to clear.
			}
		}
		const message = endMessage(ended);
		if (message) noticeStore.say(message, ended.reason !== 'unlink');
		this.#sync();
	}

	/** The store follows the session in front: the linked one, else the one joining. */
	#sync(goBackDue = false): void {
		const front = this.#linked ?? this.#pending;
		linkStore.state = front?.link.state ?? 'idle';
		linkStore.host = front?.host ?? null;
		if (goBackDue) linkStore.goBack = !!front && !front.opened;
		else if (!front || front.opened) linkStore.goBack = false;
	}
}

/** What to tell the user when a session ends, or null when they ended it themselves. */
function endMessage({ reason, by, peerProto }: Ended): string | null {
	switch (reason) {
		case 'unlink':
			return by === 'peer' ? m.link_ended_unlink() : null;
		case 'timeout':
			return m.link_ended_timeout();
		case 'version': {
			const newer = peerProto !== undefined && peerProto[0] > PROTO[0];
			return newer ? m.link_ended_update_app() : m.link_ended_update_site();
		}
		case 'room-full':
		case 'elsewhere':
			return m.link_ended_room_full();
		default:
			return null;
	}
}

export const linkService = new LinkService();
