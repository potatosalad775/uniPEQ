/**
 * What the EQ tab's sync bar and the device chip's dot say (decision 22): whether the device has
 * the EQ on screen, and the one action that would change that.
 *
 * `panelStatus` still ranks the device's own messages; this adds what happens around it: the
 * write under way, an auto-write waiting to fire, a device that needs reconnecting, and the
 * Write button for manual mode.
 */
import * as m from '$lib/paraglide/messages';
import { panelStatus, type PanelStatusInput } from './panel-status';

/** `busy`: a read or write is under way; `pending`: an auto-write is waiting to fire. */
export type SyncTone = 'muted' | 'success' | 'warning' | 'error' | 'busy' | 'pending';

export type SyncAction = 'read' | 'write' | 'review' | 'reconnect' | 'connect';

export interface SyncStatus {
	tone: SyncTone;
	text: string;
	/** The bar's buttons, the main one last. */
	actions?: SyncAction[];
	/** While `pending`: when the auto-write fires (`Date.now()` ms). */
	dueAt?: number;
}

export interface SyncInput extends PanelStatusInput {
	connected: boolean;
	/** The device the EQ is edited for, still named after it disconnected; null before any. */
	knownDevice: string | null;
	reading: boolean;
	writing: boolean;
	needsReconnect: boolean;
	/** When the waiting auto-write fires, or null. */
	autoDueAt: number | null;
	/** Write would reach a writable preset now. */
	canWrite: boolean;
	/** Read would reach the target preset now. */
	canRead: boolean;
}

/**
 * Null before any device: the bar hides, and the chip offers to connect. After a disconnect the
 * EQ is still edited for that device (decision 23), so the bar says so and offers to connect.
 */
export function syncStatus(s: SyncInput): SyncStatus | null {
	if (!s.connected) {
		if (s.knownDevice === null) return null;
		const text = m.sync_disconnected({ device: s.knownDevice });
		return { tone: 'warning', text, actions: ['connect'] };
	}
	if (s.needsReconnect) {
		// The write's own message says why ("Saved. The device restarts…"), or what broke.
		const text = s.message ?? m.device_peq_reconnect_prompt();
		return { tone: s.messageIsError ? 'error' : 'warning', text, actions: ['reconnect'] };
	}
	if (s.writing) return { tone: 'busy', text: m.device_peq_writing() };
	if (s.reading) return { tone: 'busy', text: m.device_peq_reading() };
	const failed = !!s.message && s.messageIsError;
	if (s.autoDueAt !== null && !failed) {
		return { tone: 'pending', text: m.sync_pending(), dueAt: s.autoDueAt };
	}
	const status = panelStatus(s);
	const out: SyncStatus = status ?? { tone: 'muted', text: '' };
	if (status?.action === 'review') return { ...out, actions: ['review'] };
	const urgent = status?.tone === 'error' || status?.tone === 'warning';
	// Nothing read or written since connecting: the device's own EQ is one press away, and in
	// manual mode so is sending this one. A notice about where the device is (a built-in preset,
	// one out of reach) still comes first.
	const notice = urgent || s.builtIn || s.unreachable;
	if (s.inSync === null && !notice && (s.canRead || s.canWrite)) {
		const actions: SyncAction[] = [];
		if (s.canRead) actions.push('read');
		if (!s.autoWriting && s.canWrite) actions.push('write');
		return {
			tone: 'muted',
			text: s.autoWriting ? m.sync_auto_on() : s.canRead ? m.sync_not_read() : m.sync_unwritten(),
			actions
		};
	}
	// Manual mode: whatever the device doesn't have yet is one press away.
	if (!s.autoWriting && s.canWrite && s.inSync === false) {
		return { ...out, text: urgent ? out.text : m.sync_unwritten(), actions: ['write'] };
	}
	return out;
}
