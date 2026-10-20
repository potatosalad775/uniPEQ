import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { fakeConnection } from '#lib/device-peq/__fixtures__/connection.js';
import { graphicProfile, hardwareProfile } from '#lib/eq/__fixtures__/profiles.js';
import { UNCONSTRAINED } from '#lib/eq/eq-constraint.js';
import type { EqFilter } from '#lib/eq/model.js';
import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';
import { eqStore } from '#lib/stores/eq-store.svelte.js';
import EqGraph from './EqGraph.svelte';

const pk = (freq: number, gain: number): EqFilter => ({
	type: 'PK',
	freq,
	q: 1,
	gain
});

/** The centre of band `n`'s dot, in client coordinates. */
function dotOf(n: number): { x: number; y: number; el: Element } {
	const node = document.querySelector(`[data-band="${n}"]`)!;
	const dot = node.querySelectorAll('circle')[node.querySelectorAll('circle').length - 1];
	const r = dot.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: dot };
}

function pointer(type: string, target: Element, x: number, y: number) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			pointerId: 7,
			pointerType: 'touch',
			isPrimary: true,
			button: 0,
			clientX: x,
			clientY: y
		})
	);
}

describe('EqGraph', () => {
	beforeEach(() => {
		// Editing needs a connected device; this one takes anything.
		devicePeqStore.setConnected(fakeConnection(UNCONSTRAINED), null);
		eqStore.reset();
		eqStore.replace([pk(100, 3), pk(1000, -2)], -3);
		eqStore.history.clear();
	});

	afterEach(() => devicePeqStore.forget());

	it('draws a node per band, named for screen readers', async () => {
		render(EqGraph);
		await expect
			.element(page.getByRole('button', { name: /^Band 1, PK, 100 Hz, \+3 dB/ }))
			.toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /^Band 2, PK, 1000 Hz, -2 dB/ }))
			.toBeVisible();
	});

	it('moves the focused band with the keys, and removes it with Delete', async () => {
		render(EqGraph);
		const node = page.getByRole('button', { name: /^Band 2/ });
		await node.click();
		expect(eqStore.selected).toBe(1);

		await userEvent.keyboard('{ArrowRight}');
		expect(eqStore.filters[1].freq).toBe(1029);
		await userEvent.keyboard('{ArrowUp}');
		expect(eqStore.filters[1].gain).toBe(-1.9);
		await userEvent.keyboard('{PageUp}');
		expect(eqStore.filters[1].q).toBe(1.06);
		await userEvent.keyboard('{Delete}');
		expect(eqStore.filters).toHaveLength(1);
	});

	it("resets a device's band with Delete instead of removing it", async () => {
		devicePeqStore.setConnected(fakeConnection(hardwareProfile('dac', { bandCount: 2 })), null);
		render(EqGraph);
		await page.getByRole('button', { name: /^Band 1/ }).click();
		await userEvent.keyboard('{Delete}');
		expect(eqStore.filters).toHaveLength(2);
		expect(eqStore.filters[0]).toEqual({ type: 'PK', freq: 100, q: 1, gain: 0 });
	});

	it('is read-only while the device is disconnected', async () => {
		devicePeqStore.setDisconnected();
		render(EqGraph);
		const node = page.getByRole('button', { name: /^Band 1/ });
		await expect.element(node).toHaveAttribute('aria-disabled', 'true');
		const before = eqStore.filters;
		const { x, y, el } = dotOf(0);
		pointer('pointerdown', el, x, y);
		pointer('pointermove', el, x + 60, y - 40);
		pointer('pointerup', el, x + 60, y - 40);
		await new Promise((r) => requestAnimationFrame(r));
		expect(eqStore.filters).toBe(before);
		expect(eqStore.selected).toBeNull();
	});

	it('drags a node across and up as one undo step', async () => {
		render(EqGraph);
		await expect.element(page.getByRole('button', { name: /^Band 1/ })).toBeVisible();
		const { x, y, el } = dotOf(0);
		const svg = document.querySelector('svg')!;
		pointer('pointerdown', el, x, y);
		pointer('pointermove', svg, x + 40, y - 20);
		pointer('pointermove', svg, x + 80, y - 30);
		await vi.waitFor(() => expect(eqStore.filters[0].freq).toBeGreaterThan(150));
		pointer('pointerup', svg, x + 80, y - 30);

		expect(eqStore.filters[0].gain).toBeGreaterThan(3);
		expect(eqStore.selected).toBe(0);
		eqStore.undo();
		expect(eqStore.filters[0]).toEqual(pk(100, 3));
		expect(eqStore.canUndo).toBe(false);
	});

	it('treats a short move as a tap, and a tap on the background deselects', async () => {
		render(EqGraph);
		await expect.element(page.getByRole('button', { name: /^Band 1/ })).toBeVisible();
		const { x, y, el } = dotOf(0);
		const svg = document.querySelector('svg')!;
		pointer('pointerdown', el, x, y);
		pointer('pointermove', svg, x + 1, y + 1);
		pointer('pointerup', svg, x + 1, y + 1);
		expect(eqStore.selected).toBe(0);
		expect(eqStore.canUndo).toBe(false);

		const box = svg.getBoundingClientRect();
		pointer('pointerdown', svg, box.right - 20, box.top + 20);
		pointer('pointerup', svg, box.right - 20, box.top + 20);
		expect(eqStore.selected).toBeNull();
	});

	it('adds a band where the background is double-clicked', async () => {
		render(EqGraph);
		await expect.element(page.getByRole('button', { name: /^Band 1/ })).toBeVisible();
		const svg = document.querySelector('svg')!;
		const box = svg.getBoundingClientRect();
		svg.dispatchEvent(
			new MouseEvent('dblclick', {
				bubbles: true,
				clientX: box.left + box.width * 0.8,
				clientY: box.top + 30
			})
		);
		expect(eqStore.filters).toHaveLength(3);
		expect(eqStore.filters[2].freq).toBeGreaterThan(2000);
		expect(eqStore.filters[2].gain).toBeGreaterThan(0);
		expect(eqStore.selected).toBe(2);
	});

	it("drags only the gain of a graphic EQ's band, whose frequency is fixed", async () => {
		const profile = graphicProfile('g', [
			{ freq: 100, q: 1.41 },
			{ freq: 1000, q: 1.41 }
		]);
		devicePeqStore.setConnected(fakeConnection(profile), null);
		eqStore.replace(
			[pk(100, 0), pk(1000, 0)].map((f) => ({ ...f, q: 1.41 })),
			0
		);
		render(EqGraph);
		await expect.element(page.getByRole('button', { name: /^Band 1/ })).toBeVisible();

		const { x, y, el } = dotOf(0);
		const svg = document.querySelector('svg')!;
		pointer('pointerdown', el, x, y);
		pointer('pointermove', svg, x + 60, y - 40);
		await vi.waitFor(() => expect(eqStore.filters[0].gain).toBeGreaterThan(0));
		pointer('pointerup', svg, x + 60, y - 40);
		expect(eqStore.filters[0].freq).toBe(100);
	});
});
