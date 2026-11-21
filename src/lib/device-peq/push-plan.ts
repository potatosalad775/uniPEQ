// Adapted from modernGraphTool src/lib/device-peq/push-plan.ts @ 23ddc4dd: our filter model, a
// plan per output channel where the device holds one for each, and our logger.
/**
 * What a push to a device will actually send, worked out before anything is sent.
 *
 * The bridge writes exactly what it is given — no clamping, padding or type conversion — so every
 * push goes through eqcaps' `plan`: `fit` (the wanted bands, moved onto the device's slots and
 * domains), then `complete` (every slot filled: unused ones with what the device held there,
 * written flat, when it could be read first — `readLayout` — otherwise with neutral filters), for
 * each channel that is written, and the preamp where the device takes one. Whatever `fit` had to
 * change is listed here, so the UI can show it before writing instead of the device quietly
 * holding a different EQ from the one on screen.
 */
import {
	plan,
	type Filter,
	type PlanChannel,
	type PlanHeld,
	type Profile
} from '@potatosalad775/eqcaps-core';
import { toCapsFilter } from '#lib/eq/eq-constraint.js';
import type { Channel, EqState, StereoEq } from '#lib/eq/model.js';
import { logger } from '#lib/services/logger.js';
import type { PresetRequest } from './preset';
import type { PeqCapabilities, PeqDevice } from './types';

export type PlanChange = (
	| {
			kind: 'field';
			/** 1-based band number, as the band list shows it. */
			band: number;
			field: 'type' | 'freq' | 'q' | 'gain';
			wanted: number | string;
			written: number | string;
	  }
	/** The band has no slot left on the device, or the device's rules left no room for it: not sent. */
	| { kind: 'dropped'; band: number }
	| { kind: 'preamp'; wanted: number; written: number }
) & {
	/** The channel it is in, when the channels are written apart; left out, it is both channels'. */
	channel?: Channel;
};

/** What one channel's write sends. */
export interface ChannelWrite {
	/** Exactly what to send: one written filter per device band. */
	filters: Filter[];
	/** Preamp to send, or undefined when the device takes none (or computes its own). */
	preamp?: number;
	/** Device bands nothing on screen fills: `complete` writes them flat, from the layout if given. */
	emptySlots: number;
}

export interface PushPlan extends ChannelWrite {
	/**
	 * The right channel, for a device that drives its channels apart (`drivesChannelsApart`): sent
	 * with every write, the left's own while the EQ is linked, so the device holds what is on
	 * screen. Left out, `filters` and `preamp` go to both channels.
	 */
	right?: ChannelWrite;
	changes: PlanChange[];
	/** The bands boost, and the device can't be told to lower its level: it may clip. */
	clipRisk: boolean;
	/** Something can't be met at all (a cross-band rule); the result breaks it. */
	infeasible: boolean;
}

/** What the target preset holds now, per channel, as `planPush` hints: a read of it, as it is. */
export type Layout = PlanHeld;

/**
 * The device holds an EQ per output channel and the bridge drives them apart: its profile says
 * `channels: "independent"` and its handler is `perChannel`. Only there may the EQ be set apart,
 * and only there does a write carry the right channel.
 */
export function drivesChannelsApart(
	profile: Profile,
	capabilities: Pick<PeqCapabilities, 'perChannel'>
): boolean {
	return profile.channels === 'independent' && capabilities.perChannel === true;
}

/**
 * Whether the plan sends something other than the EQ on screen, so only a reviewed write may send
 * it. Auto-write pauses on this; clip risk isn't part of it, or every device that takes no preamp
 * would pause for good.
 */
export function needsReview(plan: PushPlan): boolean {
	return plan.changes.length > 0 || plan.infeasible;
}

/** Whether the plan differs from the EQ on screen in a way the user should see first. */
export function needsConfirmation(plan: PushPlan): boolean {
	return needsReview(plan) || plan.clipRisk;
}

/** How many bands the write fills, in the channel that has more. */
export function bandsWritten(plan: PushPlan): number {
	const left = plan.filters.length - plan.emptySlots;
	return plan.right ? Math.max(left, plan.right.filters.length - plan.right.emptySlots) : left;
}

/**
 * Plan a push of the EQ to a device described by `profile`. `eq.right`, the right channel set
 * apart, is planned on its own where the device drives its channels apart, its changes and the
 * left's then named by channel; elsewhere the device gets the left channel for both.
 */
export function planPush(
	eq: StereoEq,
	profile: Profile,
	capabilities: Pick<PeqCapabilities, 'writesPreamp' | 'perChannel'>,
	layout?: Layout | null
): PushPlan {
	const wanted = ({ filters, preamp }: EqState) => ({ filters: filters.map(toCapsFilter), preamp });
	const lists = [wanted(eq), ...(eq.right ? [wanted(eq.right)] : [])];
	const { write, channels, sendsPreamp } = plan(
		profile,
		{ ...lists[0], ...(lists[1] ? { right: lists[1] } : {}) },
		{ writesPreamp: capabilities.writesPreamp, perChannel: capabilities.perChannel, held: layout }
	);
	const [left, right] = channels.map((channel, i) =>
		channelReport(channel, lists[i].filters, profile, sendsPreamp)
	);
	const leftWrite = { filters: write.filters, ...preampIn(write), emptySlots: left.emptySlots };
	if (!write.right || !right) {
		// The left's own for the right of a device that drives its channels apart, which `plan`
		// leaves to the bridge: what such a device keeps of the two follows from a write naming both.
		const both = drivesChannelsApart(profile, capabilities) ? { right: leftWrite } : {};
		return { ...leftWrite, ...both, ...left.report };
	}
	return {
		...leftWrite,
		right: {
			filters: write.right.filters,
			...preampIn(write.right),
			emptySlots: right.emptySlots
		},
		changes: [
			...left.report.changes.map((c) => ({ ...c, channel: 'left' as const })),
			...right.report.changes.map((c) => ({ ...c, channel: 'right' as const }))
		],
		clipRisk: left.report.clipRisk || right.report.clipRisk,
		infeasible: left.report.infeasible || right.report.infeasible
	};
}

const preampIn = ({ preamp }: { preamp?: number }) => (preamp !== undefined ? { preamp } : {});

/** How one written channel's fit came out: what the review lists, and the bands left unfilled. */
function channelReport(
	{ fit }: PlanChannel,
	wanted: readonly Filter[],
	profile: Profile,
	sendsPreamp: boolean
): { report: Pick<PushPlan, 'changes' | 'clipRisk' | 'infeasible'>; emptySlots: number } {
	const changes: PlanChange[] = [];
	const dropped = new Set<number>();
	fit.slotOf.forEach((slot, k) => {
		if (slot === null) dropped.add(k);
	});
	for (const c of fit.changes) {
		if (c.filter === null) {
			if (c.field === 'preamp' && sendsPreamp) {
				changes.push({ kind: 'preamp', wanted: Number(c.wanted), written: Number(c.written) });
			}
			continue;
		}
		if (dropped.has(c.filter) || c.field === 'preamp') continue;
		changes.push({
			kind: 'field',
			band: c.filter + 1,
			field: c.field,
			wanted: c.wanted,
			written: c.written
		});
	}
	for (const k of [...dropped].sort((a, b) => a - b)) {
		// A wanted band that was flat to begin with isn't a loss.
		if (wanted[k].gain !== 0) changes.push({ kind: 'dropped', band: k + 1 });
	}

	const boosts = fit.slots.some((f) => f !== null && f.gain > 0);
	return {
		report: {
			changes,
			clipRisk: boosts && profile.preamp.mode !== 'auto' && !sendsPreamp,
			infeasible: !fit.feasible
		},
		emptySlots: profile.bandCount === null ? 0 : fit.slots.filter((f) => f === null).length
	};
}

/**
 * What the preset a push will write holds now, as `planPush` hints, so the bands the push leaves
 * empty keep the device's own frequencies and Qs instead of reading back as neutral fillers. Both
 * channels where the device reads them apart. `request` is `readRequest` for that preset: null when
 * the device can't read it from where it is. A failed read is null too, and the push goes ahead
 * with neutral fillers.
 */
export async function readLayout(
	device: Pick<PeqDevice, 'pull'>,
	request: PresetRequest | null
): Promise<Layout | null> {
	if (!request) return null;
	try {
		return await device.pull(request);
	} catch (e) {
		logger.warn(
			'could not read the layout to keep, writing neutral fillers:',
			e instanceof Error ? e.message : String(e)
		);
		return null;
	}
}
