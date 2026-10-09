/**
 * The EQ checked against what it will be written to: the known device's profile (the connected
 * one, or the last one after a disconnect), or `UNCONSTRAINED` before any; the EQ tab shows no
 * editor then (decision 23). Derived only; there is no constraint picker (the connected profile is
 * the constraint, rebuild decision 20). Everything the band editor and the graph bound or flag
 * comes from here.
 */
import {
	assignSlots,
	filterViolations,
	fitFilters,
	isGraphicProfile,
	maxBandsOf,
	sameFilters,
	UNCONSTRAINED
} from '$lib/eq/eq-constraint';
import { preampControl } from '$lib/eq/preamp-control';
import { devicePeqStore } from './device-peq-store.svelte';
import { eqStore } from './eq-store.svelte';

class EqConstraintStore {
	/** A device has been connected, so there is a profile to edit for. */
	hasDevice = $derived(devicePeqStore.knownDevice !== null);
	/** The list can be edited: its device is connected (decision 25). Read-only otherwise. */
	editable = $derived(devicePeqStore.canEdit);
	profile = $derived(devicePeqStore.knownDevice?.profile ?? UNCONSTRAINED);
	isGraphic = $derived(isGraphicProfile(this.profile));
	/** Band cap; 0 = unlimited. */
	maxBands = $derived(maxBandsOf(this.profile));
	/**
	 * The device has a set number of bands (decision 23): the list is that many rows, so bands are
	 * reset rather than added or removed. Only rows past the count can go.
	 */
	fixedBands = $derived(this.profile.bandCount !== null);
	/** How many bands short of the device's count the list is (what Fit fills in flat). */
	missing = $derived(
		this.profile.kind === 'hardware' && !this.isGraphic && this.maxBands > 0
			? Math.max(0, this.maxBands - eqStore.filters.length)
			: 0
	);
	/** The slot each band sits in. */
	slots = $derived(assignSlots(eqStore.filters, this.profile));
	/** Per band, which fields the profile doesn't take (eqcaps `validateList`). */
	violations = $derived(filterViolations(eqStore.filters, this.profile));
	/** How many bands break the profile, those past its band cap included. */
	misfits = $derived(
		this.violations.filter((v) => v.type || v.freq || v.q || v.gain).length +
			(this.maxBands > 0 ? Math.max(0, eqStore.filters.length - this.maxBands) : 0)
	);
	canAdd = $derived(this.editable && !this.fixedBands);
	preamp = $derived(preampControl(this.profile, devicePeqStore.capabilities?.writesPreamp ?? null));
	/** Whether band `i` may be removed, not only reset: always without a set count, else past it. */
	canRemove(i: number): boolean {
		return this.editable && (!this.fixedBands || i >= this.maxBands);
	}

	/** What Fit would make of the list, or null when it would change nothing. */
	fitted = $derived.by(() => {
		const next = fitFilters(eqStore.filters, this.profile);
		return sameFilters(next, eqStore.filters) ? null : next;
	});
}

export const eqConstraintStore = new EqConstraintStore();
