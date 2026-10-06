import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoPushScheduler, type SyncStatus } from './auto-push-scheduler';

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('AutoPushScheduler', () => {
	let statuses: SyncStatus[];
	beforeEach(() => {
		vi.useFakeTimers();
		statuses = [];
	});
	afterEach(() => vi.useRealTimers());

	it('debounces edits into one push after the delay', async () => {
		const push = vi.fn(async () => undefined);
		const scheduler = new AutoPushScheduler(push, (s) => statuses.push(s), 1500);

		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(1000);
		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(1000);
		expect(push).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(500);
		expect(push).toHaveBeenCalledTimes(1);
		expect(statuses).toEqual(['pending', 'pending', 'pushing', 'synced']);
	});

	it('pushes once more after an in-flight push when edits arrived meanwhile', async () => {
		const first = deferred();
		const push = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
		const scheduler = new AutoPushScheduler(push, (s) => statuses.push(s), 100);

		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(100);
		expect(push).toHaveBeenCalledTimes(1);

		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(100);
		expect(push).toHaveBeenCalledTimes(1); // deferred, not concurrent

		first.resolve();
		await vi.runAllTimersAsync();
		expect(push).toHaveBeenCalledTimes(2);
		expect(statuses.at(-1)).toBe('synced');
	});

	it('reports errors from a timed push without an unhandled rejection', async () => {
		const push = vi.fn().mockRejectedValue(new Error('unplugged'));
		const scheduler = new AutoPushScheduler(push, (s) => statuses.push(s), 100);

		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(100);
		expect(statuses).toEqual(['pending', 'pushing', 'error']);
	});

	it('pushNow() cancels the timer, pushes at once and rethrows failures', async () => {
		const push = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue(undefined);
		const scheduler = new AutoPushScheduler(push, (s) => statuses.push(s), 100);

		scheduler.notifyChange();
		await expect(scheduler.pushNow()).rejects.toThrow('nope');
		await vi.advanceTimersByTimeAsync(100);
		expect(push).toHaveBeenCalledTimes(1);

		await scheduler.pushNow();
		expect(statuses.at(-1)).toBe('synced');
	});

	it('only reports editing while disabled (manual-save mode)', async () => {
		const push = vi.fn(async () => undefined);
		const scheduler = new AutoPushScheduler(push, (s) => statuses.push(s), 100);

		scheduler.notifyChange();
		scheduler.setEnabled(false);
		scheduler.notifyChange();
		await vi.advanceTimersByTimeAsync(500);
		expect(push).not.toHaveBeenCalled();
		expect(statuses).toEqual(['pending', 'editing']);
	});
});
