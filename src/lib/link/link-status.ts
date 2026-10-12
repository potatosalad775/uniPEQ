/**
 * The modernGraphTool link on the EQ tab's sync bar, which it shares with the device: one status
 * line, so the link speaks only while it waits on something (joining, asking, mGT gone quiet, the
 * browser to come back to). Linked and steady, it leaves the bar to the device; the EQ menu's dot
 * says it's linked. The battery tip is a dialog (`LinkBatteryDialog`), not a line.
 */
import type { JoinerState } from 'peq-link/client';
import type { SyncStatus } from '$lib/device-peq/sync-status';
import * as m from '$lib/paraglide/messages';

export interface BarStatus extends SyncStatus {
	/** A link line: the link icon in place of the tone's. */
	link?: boolean;
}

export interface LinkInput {
	state: JoinerState | 'idle';
	host: string | null;
	goBack: boolean;
}

/** The link's state in a few words (the EQ menu's Unlink), or null without one. */
export function linkLabel(state: JoinerState | 'idle', host: string | null): string | null {
	switch (state) {
		case 'joining':
			return m.link_row_joining();
		case 'approval':
			return m.link_row_approval({ host: host ?? '' });
		case 'waiting':
			return m.link_row_waiting();
		case 'linked':
			return m.link_row_linked({ host: host ?? '' });
		default:
			return null;
	}
}

/** What the link has to say, or null when it waits on nothing. */
export function linkStatus(l: LinkInput): BarStatus | null {
	if (l.state === 'idle' || l.state === 'ended' || l.state === 'linked') return null;
	if (l.goBack) return { tone: 'warning', link: true, text: m.link_go_back() };
	const text = linkLabel(l.state, l.host) ?? '';
	return { tone: l.state === 'waiting' ? 'muted' : 'busy', link: true, text };
}

/**
 * The bar's one line: a device that needs the user (disconnected, an error, Read or Write to
 * choose) first, since a stuck device matters more than a quiet browser; then the link's; then the
 * device's routine news (writing, the auto-write ring, in sync).
 */
export function statusLine(device: SyncStatus | null, link: BarStatus | null): BarStatus | null {
	if (!link) return device;
	if (device && (device.tone === 'error' || device.tone === 'warning')) return device;
	return link;
}
