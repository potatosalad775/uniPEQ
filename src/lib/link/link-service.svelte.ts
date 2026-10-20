/**
 * uniPEQ's side of the modernGraphTool link: joins the room the user picked (an intent link, the
 * QR code's App Link or a typed code), asks for approval, then owns the shared band list and is the
 * only side that writes the device. The protocol is the reference client's (`peq-link/client`);
 * this binds its handlers to the stores and its events to the UI.
 *
 * - Edits apply through `eqStore`, one undo step per burst, a band projected onto its slot as a
 *   local edit is. Nothing applies while the list can't be edited.
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
	type LinkDevice,
	type LinkEq,
	type LinkStatus,
	type PlanChange
} from 'peq-link/client';
import type { PushPlan } from '#lib/device-peq/push-plan.js';
import { editFilter } from '#lib/eq/eq-constraint.js';
import type { EqFilter, FilterType } from '#lib/eq/model.js';
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

type Snapshot = Pick<LinkEq, 'filters' | 'preamp' | 'autoPreamp'>;

function snapshot(): Snapshot {
	return {
		filters: eqStore.filters,
		// As written: Auto's on the device's grid.
		preamp: eqConstraintStore.preampValue,
		autoPreamp: eqStore.autoPreamp
	};
}

function same(a: Snapshot, b: Snapshot): boolean {
	return a.filters === b.filters && a.preamp === b.preamp && a.autoPreamp === b.autoPreamp;
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
			experimental: c.experimental
		}
	};
}

function deviceName(): string | null {
	return devicePeqStore.connection?.name ?? devicePeqStore.knownDevice?.name ?? null;
}

/** A device command: its effects reach mGT as `eq`, `status` and `device`; `re` says if it failed. */
async function deviceCommand(work: () => Promise<unknown>): Promise<CommandResult> {
	if (!devicePeqStore.connection) return { ok: false, code: 'no-device' };
	const before = devicePeqStore.failure;
	await whileAwake(work);
	const failure = devicePeqStore.failure;
	return failure && failure !== before ? { ok: false, code: failure.code } : { ok: true };
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
	#applied: Snapshot | null = null;
	/** What the effect last saw of the list, and the fresh starts it counted. */
	#seen: Snapshot | null = null;
	#epoch = 0;
	/** mGT edits without a burst are one undo step each. */
	#unbursted = 0;
	/** The review mGT is shown, with the `rev` it was planned at. */
	#review: { plan: PushPlan; rev: number } | null = null;
	#dispose: (() => void)[] = [];
	#watching = false;

	constructor(server: string, room: string, events: SessionEvents) {
		this.server = server;
		this.room = room;
		this.link = startJoiner({
			server,
			room,
			version: __APP_VERSION__,
			defaultServer: DEFAULT_SERVER,
			foreground: appState.active,
			handlers: {
				eq: snapshot,
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
					const now = snapshot();
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

	#localChange(now: Snapshot, step: number, epoch: number): void {
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
		const before = snapshot();
		for (const op of ops) applyOp(op, key);
		const after = snapshot();
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
			editable: store.canEdit,
			activeSlot: store.activeSlot,
			deviceSlot: store.deviceSlot,
			eqEnabled: store.eqEnabled,
			busy: store.isConnecting
				? 'connect'
				: store.isReading
					? 'read'
					: store.isWriting
						? 'write'
						: store.isSwitching
							? 'switch'
							: null,
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
		this.#pending = new Session(target.server, target.room, this.#events);
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
