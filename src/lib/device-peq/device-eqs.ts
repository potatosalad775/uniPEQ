/**
 * A device's EQs (eqcaps SPEC §9.2) and the connection viewed as one of them.
 *
 * A Qudelix 5K has its user EQ, which its profile describes, and a headphone EQ the profile lists
 * in `protocol.eqs`, with its own bands, presets, switch and left and right channels. The app
 * edits one at a time: the store keeps which, and hands everything past it the connection as that
 * EQ alone (`eqView`), so the document, the sync state, the presets and the channel row are that
 * EQ's without any of them knowing there are others.
 */
import { eqProfile, profileEqs } from '@potatosalad775/eqcaps-core';
import * as m from '#lib/paraglide/messages.js';
import type { DeviceConnection } from './types';

/** One of a device's EQs, as the EQ row offers it. */
export interface DeviceEq {
	/** Its id in the bridge's `capabilities.eqs`; undefined for the EQ the profile describes. */
	id: string | undefined;
	/** The data's name for it ("SPK EQ"); undefined where the data gives none. */
	name: string | undefined;
	/**
	 * It is there in the device's current mode. A Qudelix in single-EQ mode has no headphone EQ,
	 * and answers any operation on it as `unsupported`.
	 */
	present: boolean;
}

/** The EQ the connection is viewed as. */
export interface EqTarget {
	/** As in `DeviceEq`. */
	id: string | undefined;
	/**
	 * The band count the device reports for it, where that differs from the data's: writing fewer
	 * bands than the device has would leave the rest playing what they held. Null: the data's.
	 */
	bandCount: number | null;
}

/** The EQ the profile describes, as the data counts its bands: where every connection starts. */
export const OWN_EQ: EqTarget = { id: undefined, bandCount: null };

/**
 * The device's EQs: the profile's own first, then the ones it lists that the bridge drives, by
 * the data's names. `absent` are the ids the device's current mode lacks.
 */
export function deviceEqs(conn: DeviceConnection, absent: readonly string[]): DeviceEq[] {
	const driven = conn.device.capabilities.eqs.map((e) => e.id);
	return profileEqs(conn.profile)
		.filter((eq) => eq.id === undefined || driven.includes(eq.id))
		.map(({ id, name }) => ({ id, name, present: id === undefined || !absent.includes(id) }));
}

/** An EQ's label: the data's name, else "Main EQ" (only the profile's own can lack one). */
export function eqLabel(eq: { name?: string }): string {
	return eq.name ?? m.eq_target_main();
}

/**
 * `conn` viewed as one of its EQs: that EQ's profile (its band count, presets and channels) with
 * the device viewed as it (`eq()`), whose operations, presets and channels are that EQ's. The
 * firmware, the controls and closing are the device's on every view. The profile's own EQ is how
 * the device was opened, so its view is `conn` itself unless the device reports another band count.
 */
export function eqView(conn: DeviceConnection, eq: EqTarget): DeviceConnection {
	const own = eqProfile(conn.profile, eq.id);
	if (!own) throw new Error(`${conn.name} has no EQ "${eq.id}"`);
	const profile = eq.bandCount === null ? own : { ...own, bandCount: eq.bandCount };
	if (eq.id === undefined) return profile === conn.profile ? conn : { ...conn, profile };
	// The name ends in the profile's own EQ ("Qudelix 5K · USR EQ") where the data labels it: the
	// view is named for the EQ it is. A name from elsewhere (a guessed device) is left alone.
	const name = conn.name === labelOf(conn.profile) ? labelOf(profile) : conn.name;
	return { ...conn, name, profile, device: conn.device.eq(eq.id) };
}

/** A profile's device and EQ label, as a connection is named for it. */
function labelOf({ device, engine }: DeviceConnection['profile']): string {
	const name = `${device.brand} ${device.model}`;
	return engine ? `${name} · ${engine}` : name;
}
