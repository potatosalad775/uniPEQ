/**
 * The EQ checked against what it will be written to: the connected device's profile, or
 * `UNCONSTRAINED` with none. Derived only; there is no constraint picker (the connected profile is
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
	profile = $derived(devicePeqStore.profile ?? UNCONSTRAINED);
	isGraphic = $derived(isGraphicProfile(this.profile));
	/** Band cap; 0 = unlimited. */
	maxBands = $derived(maxBandsOf(this.profile));
	/** The slot each band sits in. */
	slots = $derived(assignSlots(eqStore.filters, this.profile));
	/** Per band, which fields the profile doesn't take (eqcaps `validateList`). */
	violations = $derived(filterViolations(eqStore.filters, this.profile));
	/** How many bands break the profile, those past its band cap included. */
	misfits = $derived(
		this.violations.filter((v) => v.type || v.freq || v.q || v.gain).length +
			(this.maxBands > 0 ? Math.max(0, eqStore.filters.length - this.maxBands) : 0)
	);
	canAdd = $derived(
		!this.isGraphic && (this.maxBands === 0 || eqStore.filters.length < this.maxBands)
	);
	preamp = $derived(preampControl(this.profile, devicePeqStore.capabilities?.writesPreamp ?? null));
	/** What Fit would make of the list, or null when it would change nothing. */
	fitted = $derived.by(() => {
		const next = fitFilters(eqStore.filters, this.profile);
		return sameFilters(next, eqStore.filters) ? null : next;
	});
}

export const eqConstraintStore = new EqConstraintStore();
