import { describe, expect, it } from 'vitest';
import { syncStatus, type SyncInput } from './sync-status';

const BASE: SyncInput = {
	connected: true,
	knownDevice: 'KA17',
	operation: null,
	needsReconnect: false,
	reconnecting: false,
	autoDueAt: null,
	canWrite: true,
	canRead: true,
	message: null,
	messageIsError: false,
	autoWriting: false,
	autoPaused: false,
	autoClipRisk: false,
	builtIn: false,
	unreachable: false,
	inSync: null,
	unwritten: false
};

const status = (patch: Partial<SyncInput>) => syncStatus({ ...BASE, ...patch });

describe('syncStatus', () => {
	it('hides before any device', () => {
		expect(status({ connected: false, knownDevice: null })).toBeNull();
	});

	it('says a known device is disconnected, and offers to connect', () => {
		expect(status({ connected: false })).toEqual({
			tone: 'warning',
			text: 'KA17 is disconnected. Connect it to edit.',
			actions: ['connect']
		});
	});

	it('offers Read, and Write in manual mode, before anything was read or written', () => {
		expect(status({})?.actions).toEqual(['read', 'write']);
		expect(status({ autoWriting: true })).toMatchObject({
			tone: 'muted',
			text: 'Auto-write is on: your next edit goes to the device.',
			actions: ['read']
		});
	});

	it('offers Write and Read for changes kept from before, in either mode', () => {
		for (const autoWriting of [false, true]) {
			expect(status({ unwritten: true, autoWriting })).toEqual({
				tone: 'warning',
				text: "Earlier changes aren't on the device yet.",
				actions: ['read', 'write']
			});
		}
		// Once read or written, the list is compared with the device as usual.
		expect(status({ unwritten: true, inSync: true })?.actions).toBeUndefined();
	});

	it('counts down a waiting auto-write, and shows a write under way', () => {
		expect(status({ autoWriting: true, autoDueAt: 123, inSync: false })).toMatchObject({
			tone: 'pending',
			dueAt: 123
		});
		expect(status({ operation: 'write', autoDueAt: 123 })?.tone).toBe('busy');
	});

	it('shows every operation under way', () => {
		for (const operation of ['read', 'write', 'switch', 'control'] as const) {
			expect(status({ operation, inSync: true })?.tone).toBe('busy');
		}
	});

	it("says what was just done over the offer to read, and keeps the offer's buttons", () => {
		expect(status({ message: 'Set Mic gain to 12 dB.' })).toEqual({
			tone: 'muted',
			text: 'Set Mic gain to 12 dB.',
			actions: ['read', 'write']
		});
		expect(status({ inSync: true, message: 'Set Mic gain to 12 dB.' })).toMatchObject({
			tone: 'success',
			text: 'Set Mic gain to 12 dB.'
		});
	});

	it('lets a failure outrank a waiting auto-write', () => {
		const s = status({ autoDueAt: 123, message: 'No answer', messageIsError: true });
		expect(s).toMatchObject({ tone: 'error', text: 'No answer' });
	});

	it('offers Write in manual mode once the list has moved on', () => {
		expect(status({ inSync: false })).toMatchObject({
			text: 'Changes not written to the device yet.',
			actions: ['write']
		});
		expect(status({ inSync: false, autoWriting: true })?.actions).toBeUndefined();
	});

	it('says so once the device has the list', () => {
		expect(status({ inSync: true, message: 'Wrote 3 band(s) to the device' })).toEqual({
			tone: 'success',
			text: 'Wrote 3 band(s) to the device'
		});
	});

	it('puts a built-in preset before the offer to read', () => {
		const s = status({ builtIn: true, canWrite: false });
		expect(s?.text).toMatch(/built-in device preset/);
		expect(s?.actions).toBeUndefined();
	});

	it("keeps a paused auto-write's Review", () => {
		expect(status({ autoWriting: true, autoPaused: true, inSync: false })?.actions).toEqual([
			'review'
		]);
	});

	it('asks to reconnect, with the reason the write gave', () => {
		expect(status({ needsReconnect: true, message: 'Saved. Reconnect.' })).toEqual({
			tone: 'warning',
			text: 'Saved. Reconnect.',
			actions: ['reconnect']
		});
	});

	it('offers no Reconnect while the device is being reopened', () => {
		expect(
			status({ needsReconnect: true, reconnecting: true, message: 'Saved. Reconnecting…' })
		).toEqual({ tone: 'busy', text: 'Saved. Reconnecting…' });
	});
});
