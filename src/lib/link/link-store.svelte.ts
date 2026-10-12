/**
 * The modernGraphTool link as the UI shows it: the session's state and peer, the approval being
 * asked, and the self-check's battery tip. `link-service.svelte.ts` runs the session; this only
 * holds what screens read, and imports nothing of the link client, so it costs the boot bundle
 * nothing.
 */
import type { ApprovalRequest, JoinerState } from 'peq-link/client';

/** Survives a crash: an approved session that never ended means Android killed uniPEQ. */
export const CRASH_MARKER_KEY = 'unipeq.link.session';
/** The battery tip is shown once, ever. */
const TIP_SEEN_KEY = 'unipeq.link.batteryTip';

export interface LinkApproval {
	request: ApprovalRequest;
	/** `squig.link`: the host of mGT's attested origin. */
	host: string;
	/** The linked host this would replace ("End the link with <host A>…"), if any. */
	replaces: string | null;
}

class LinkStore {
	/** The session in front: linked (or waiting for mGT), else the one joining; idle without one. */
	state = $state<JoinerState | 'idle'>('idle');
	/** mGT's attested host (`squig.link`), once signaling named it. */
	host = $state<string | null>(null);
	/** An approval the user hasn't answered. */
	approval = $state.raw<LinkApproval | null>(null);
	/** The DataChannel hasn't opened a while after joining: the browser has to be in front. */
	goBack = $state(false);
	/** The self-check's one-time tip: Android paused (or killed) uniPEQ while linked. */
	batteryTip = $state(false);

	get linked(): boolean {
		return this.state === 'linked' || this.state === 'waiting';
	}

	/** Joining, asking or linked: Link with modernGraphTool becomes Unlink. */
	get active(): boolean {
		return this.state !== 'idle' && this.state !== 'ended';
	}

	/** Show the battery tip, unless it was shown before. */
	tip(): void {
		try {
			if (localStorage.getItem(TIP_SEEN_KEY)) return;
			localStorage.setItem(TIP_SEEN_KEY, '1');
		} catch {
			// Storage can throw in locked-down WebViews: show it this once anyway.
		}
		this.batteryTip = true;
	}
}

export const linkStore = new LinkStore();

/** The link service, loaded on first use: the link client stays out of the boot bundle. */
export function loadLinkService() {
	return import('./link-service.svelte').then(({ linkService }) => {
		linkService.install();
		return linkService;
	});
}
