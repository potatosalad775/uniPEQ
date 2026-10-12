/**
 * The modernGraphTool link's native side (the app module's `Link` plugin, LinkPlugin.java): the
 * foreground service with its notification, keep-visible, and a wake lock around device commands.
 * Every export is a no-op on the web, where a tab has no service to start.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative } from './native';

interface LinkPlugin {
	start(options: { host: string; device: string | null }): Promise<void>;
	update(options: { host: string; device: string | null }): Promise<void>;
	stop(): Promise<void>;
	wake(options: { ms: number }): Promise<void>;
	release(): Promise<void>;
	state(): Promise<{ backgroundRestricted: boolean }>;
	openSettings(): Promise<void>;
	addListener(event: 'unlink', listener: () => void): Promise<PluginListenerHandle>;
}

const Link = registerPlugin<LinkPlugin>('Link');

/** How long one device command may hold the CPU awake. */
const WAKE_MS = 10_000;

/** Starts the service (notification "Linked with <host> · <device>") and keep-visible. */
export function startLinkService(host: string, device: string | null): void {
	if (isNative) void Link.start({ host, device }).catch(() => {});
}

export function updateLinkService(host: string, device: string | null): void {
	if (isNative) void Link.update({ host, device }).catch(() => {});
}

export function stopLinkService(): void {
	if (isNative) void Link.stop().catch(() => {});
}

let holding = 0;

/**
 * Runs `work` under a partial wake lock. Whether a USB write finishes in deep Doze before the CPU
 * sleeps again is untested, and a failure there would be silent, so every device command holds
 * one. Overlapping commands share it; the last one to finish releases it.
 */
export async function whileAwake<T>(work: () => Promise<T>): Promise<T> {
	if (!isNative) return work();
	holding++;
	void Link.wake({ ms: WAKE_MS }).catch(() => {});
	try {
		return await work();
	} finally {
		if (--holding === 0) void Link.release().catch(() => {});
	}
}

/** Whether the Restricted battery setting is on, under which Android pauses uniPEQ anyway. */
export async function backgroundRestricted(): Promise<boolean> {
	if (!isNative) return false;
	return Link.state()
		.then((s) => s.backgroundRestricted)
		.catch(() => false);
}

/** The app's system settings page, where battery use is set. */
export function openAppSettings(): void {
	if (isNative) void Link.openSettings().catch(() => {});
}

/** The notification's Unlink (or the task swiped away). Returns the unsubscribe. */
export function onNativeUnlink(listener: () => void): () => void {
	if (!isNative) return () => {};
	const handle = Link.addListener('unlink', listener);
	return () => void handle.then((h) => h.remove());
}
