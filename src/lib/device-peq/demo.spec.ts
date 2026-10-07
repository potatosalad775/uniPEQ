/**
 * The demo pipeline (rebuild decision 2, Phase 3 exit): connect the demo device through
 * `openDevice`, read it, plan a write with `fit` + `complete`, write it and read it back, all over
 * the real `fiio-usb-hid` handler talking to the simulated device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateProfile } from '@potatosalad775/eqcaps-core';
import type { Filter } from '@potatosalad775/eqcaps-core';
import { fromCapsFilter, type EqFilter } from '$lib/eq/model';

vi.mock('@potatosalad775/eqcaps-device-bridge/browser', () => ({}));
vi.mock('$lib/services/eqcaps-client', () => ({ eqcapsClient: () => ({}) }));

const { connectDemo } = await import('./connect');
const { DEMO_PROFILE, DemoDac, DemoHidTransport, resetDemoDac } = await import('./demo');
const { needsConfirmation, planPush, readLayout } = await import('./push-plan');

async function connect() {
	const result = await connectDemo();
	if (result.kind !== 'connected') throw new Error(`demo did not connect: ${result.kind}`);
	return result.connection;
}

const toApp = (filters: Filter[]): EqFilter[] =>
	filters.map(fromCapsFilter).filter((f) => f !== null);

describe('demo profile', () => {
	it('is a valid eqcaps profile', () => {
		expect(validateProfile(DEMO_PROFILE).filter((i) => i.severity === 'error')).toEqual([]);
	});
});

describe('demo device', () => {
	// Each test starts from a freshly seeded device.
	beforeEach(() => resetDemoDac());

	it('connects through openDevice as a FiiO-protocol device on its first user preset', async () => {
		const conn = await connect();
		expect(conn.name).toBe('uniPEQ Demo DAC');
		expect(conn.profileSource).toBe('device');
		expect(conn.profileId).toBe('unipeq-demo-dac');
		expect(conn.device.capabilities).toMatchObject({
			canRead: true,
			canWrite: true,
			readsSlot: false,
			writesSlot: true,
			canEnable: true
		});
		expect(conn.device.capabilities.slots.map((s) => s.name)).toEqual([
			'USER1',
			'USER2',
			'USER3',
			'Bypass'
		]);
		expect(await conn.device.currentSlot()).toBe(1);
	});

	it('reads its seeded preset', async () => {
		const conn = await connect();
		const { filters, preamp, slot } = await conn.device.pull({});
		expect(filters).toHaveLength(10);
		expect(filters[0]).toEqual({ type: 'LSC', freq: 105, q: 0.7, gain: 4.5 });
		expect(preamp).toBe(-4.5);
		expect(slot).toBe(1);
	});

	it('writes what fit produced and reads it back', async () => {
		const conn = await connect();
		const { device, profile } = conn;
		const read = toApp((await device.pull({})).filters.filter((f) => f !== null));
		const edited: EqFilter[] = [
			{ ...read[0], gain: 6 },
			{ type: 'PK', freq: 3150, q: 0.707, gain: -13 },
			...read.slice(2, 5)
		];
		const hints = await readLayout(device, {});
		const plan = planPush(edited, -6, profile, device.capabilities, hints ?? undefined);

		expect(needsConfirmation(plan)).toBe(true);
		expect(plan.changes).toEqual([
			{ kind: 'field', band: 2, field: 'q', wanted: 0.707, written: 0.71 },
			{ kind: 'field', band: 2, field: 'gain', wanted: -13, written: -12 }
		]);
		expect(plan.emptySlots).toBe(5);

		await device.push({ filters: plan.filters, preamp: plan.preamp, slot: 1 });
		const back = await device.pull({});
		expect(back.filters).toEqual(plan.filters);
		expect(back.preamp).toBe(-6);
		// The bands the list left empty kept the preset's own layout, written flat.
		expect(back.filters.slice(5).map((f) => [f?.type, f?.freq, f?.gain])).toEqual([
			['PK', 4000, 0],
			['PK', 6500, 0],
			['PK', 8000, 0],
			['PK', 11000, 0],
			['HSC', 10000, 0]
		]);
	});

	it('saves into another preset without changing what plays, then switches to it', async () => {
		const { device } = await connect();
		const before = await device.pull({});
		const plan = planPush(
			[{ type: 'PK', freq: 1000, q: 1, gain: 3 }],
			-3,
			DEMO_PROFILE,
			device.capabilities
		);
		await device.push({ filters: plan.filters, preamp: plan.preamp, slot: 2 });
		expect(await device.pull({})).toEqual(before);

		await device.setEnabled(true, 2);
		expect(await device.currentSlot()).toBe(2);
		expect((await device.pull({})).filters[0]).toEqual({ type: 'PK', freq: 1000, q: 1, gain: 3 });
	});

	it('turns its EQ off on the bypass preset', async () => {
		const { device } = await connect();
		await device.setEnabled(false);
		expect(await device.currentSlot()).toBeNull();
		await device.setEnabled(true, 3);
		expect(await device.currentSlot()).toBe(3);
	});

	it('reopens onto the same device, with what was written', async () => {
		const conn = await connect();
		await conn.device.setEnabled(true, 3);
		await conn.device.close();
		await expect(conn.device.pull({})).rejects.toMatchObject({ code: 'transport' });

		const again = await conn.reopen!();
		expect(await again!.device.currentSlot()).toBe(3);
	});

	it('answers only on its own report id', async () => {
		const transport = new DemoHidTransport(new DemoDac(), 0);
		const seen = vi.fn();
		transport.onInputReport(seen);
		await transport.sendReport(1, Uint8Array.from([0xbb, 0x0b, 0, 0, 0x16, 0, 0, 0xee]));
		await new Promise((r) => setTimeout(r, 10));
		expect(seen).not.toHaveBeenCalled();
	});
});
