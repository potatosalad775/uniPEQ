/**
 * While linked on Android, reports when uniPEQ was paused anyway, instead of failing silently:
 * other brands, the Restricted battery setting and WebView changes can defeat the foreground
 * service and keep-visible.
 *
 * - `frozen`: Chromium froze the page (`freeze`, then `resume`): keep-visible didn't hold.
 * - `hidden`: the page stayed hidden while keep-visible was on: keep-visible was lost.
 * - `stopped`: a 1 s timer came back more than `GAP_MS` late: the whole process was stopped.
 *
 * The timer only measures; it never drives device work. Each pause is reported once it's over,
 * with how long it lasted.
 */
import type { PauseCause } from 'peq-link/client';

/** Deep Doze delays a 1 s timer by up to ~6 s; a gap this long is a pause, not drift. */
const GAP_MS = 30_000;
const TICK_MS = 1_000;
/**
 * Keep-visible re-asserts every 5 s after a relayout sends the window GONE again, so a short
 * hidden spell is it working; Chromium freezes only after 60 s hidden.
 */
const HIDDEN_MS = 10_000;

export function startSelfCheck(report: (cause: PauseCause, ms: number) => void): () => void {
	let frozenAt: number | null = null;
	let hiddenAt: number | null = null;
	let lastTick = Date.now();

	const onFreeze = () => (frozenAt = Date.now());
	const onResume = () => {
		if (frozenAt === null) return;
		report('frozen', Date.now() - frozenAt);
		frozenAt = null;
		// The freeze stopped the timer too; one pause, reported once.
		lastTick = Date.now();
	};
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') hiddenAt ??= Date.now();
		else if (hiddenAt !== null) {
			const ms = Date.now() - hiddenAt;
			hiddenAt = null;
			if (ms >= HIDDEN_MS) report('hidden', ms);
		}
	};
	const timer = setInterval(() => {
		const now = Date.now();
		const gap = now - lastTick - TICK_MS;
		lastTick = now;
		if (gap > GAP_MS) report('stopped', gap);
	}, TICK_MS);

	document.addEventListener('freeze', onFreeze);
	document.addEventListener('resume', onResume);
	document.addEventListener('visibilitychange', onVisibility);
	return () => {
		clearInterval(timer);
		document.removeEventListener('freeze', onFreeze);
		document.removeEventListener('resume', onResume);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
