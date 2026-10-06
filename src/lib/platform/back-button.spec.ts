import { describe, expect, it } from 'vitest';
import { dispatchBack, onBack } from './back-button';

describe('back button stack', () => {
	it('offers the press newest first and stops at the first taker', () => {
		const calls: string[] = [];
		const removeShell = onBack(() => (calls.push('shell'), true));
		const removeSheet = onBack(() => (calls.push('sheet'), true));

		expect(dispatchBack()).toBe(true);
		expect(calls).toEqual(['sheet']);

		removeSheet();
		expect(dispatchBack()).toBe(true);
		expect(calls).toEqual(['sheet', 'shell']);
		removeShell();
	});

	it('falls through handlers that decline, and reports when none took it', () => {
		const calls: string[] = [];
		const remove = onBack(() => (calls.push('declines'), false));

		expect(dispatchBack()).toBe(false);
		expect(calls).toEqual(['declines']);
		remove();
		expect(dispatchBack()).toBe(false);
	});

	it('removes only its own registration', () => {
		const handler = () => true;
		const removeFirst = onBack(handler);
		const removeSecond = onBack(handler);
		removeSecond();
		removeSecond(); // idempotent
		expect(dispatchBack()).toBe(true);
		removeFirst();
		expect(dispatchBack()).toBe(false);
	});
});
