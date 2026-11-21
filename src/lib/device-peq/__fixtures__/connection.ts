/**
 * A connection to a device that does nothing, for specs that need a profile to be the active
 * constraint (`devicePeqStore.setConnected(fakeConnection(profile), null)`).
 */
import type { Eq, Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceConnection, PeqCapabilities, PeqDevice } from '../types';

/**
 * Another EQ of the device, as its profile lists it (`protocol.eqs`), plus whether the bridge
 * drives its channels apart: it goes into both the profile and `capabilities.eqs`, and `eq(id)`
 * gives the device viewed as it, with operations of its own that do nothing.
 */
export type FakeEq = Eq & { perChannel?: boolean };

export function fakeConnection(
	profile: Profile,
	over: Partial<PeqCapabilities> = {},
	eqs: readonly FakeEq[] = []
): DeviceConnection {
	const listed: Profile =
		eqs.length === 0
			? profile
			: {
					...profile,
					protocol: {
						handler: 'fake',
						...profile.protocol,
						eqs: eqs.map(({ perChannel: _, ...eq }) => eq)
					}
				};
	const capabilities: PeqCapabilities = {
		canRead: true,
		canWrite: true,
		readsPreamp: true,
		readsSlot: false,
		writesPreamp: true,
		writesSlot: false,
		readsCurrentSlot: false,
		readsEnabled: false,
		canEnable: false,
		slots: [],
		disconnectOnSave: false,
		experimental: false,
		readsFirmware: false,
		readsBandCount: false,
		controls: [],
		perChannel: false,
		eqs: eqs.map(({ id, name, bandCount, presets, perChannel }) => ({
			id,
			name,
			...(bandCount !== undefined ? { bandCount } : {}),
			slots: presets ?? [],
			perChannel: perChannel ?? false
		})),
		...over
	};
	const views = new Map<string | undefined, PeqDevice>();
	/** The device viewed as one EQ, as the bridge gives it: the same view each time. */
	const view = (id?: string): PeqDevice => {
		const known = views.get(id);
		if (known) return known;
		const info = capabilities.eqs.find((e) => e.id === id);
		if (id !== undefined && !info) throw new Error(`no EQ "${id}" here`);
		const device: PeqDevice = {
			capabilities: info
				? { ...capabilities, slots: info.slots, perChannel: info.perChannel }
				: capabilities,
			pull: async () => ({ filters: [], preamp: 0 }),
			push: async () => ({ reconnect: false }),
			currentSlot: async () => null,
			eqEnabled: async () => null,
			setEnabled: async () => {},
			firmware: async () => null,
			bandCount: async () => null,
			readControls: async () => ({}),
			writeControl: async () => ({ reconnect: false }),
			eq: view,
			close: async () => {}
		};
		views.set(id, device);
		return device;
	};
	return {
		device: view(),
		connectionType: 'hid',
		name: `${listed.device.brand} ${listed.device.model}`,
		profile: listed,
		profileSource: 'device',
		profileId: listed.id,
		identity: {}
	};
}
