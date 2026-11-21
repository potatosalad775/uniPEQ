/**
 * A connection to a device that does nothing, for specs that need a profile to be the active
 * constraint (`devicePeqStore.setConnected(fakeConnection(profile), null)`).
 */
import type { Eq, Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceConnection, PeqCapabilities } from '../types';

/**
 * Another EQ of the device, as its profile lists it (`protocol.eqs`), plus whether the bridge
 * drives its channels apart: it goes into both the profile and `capabilities.eqs`.
 */
export type FakeEq = Eq & { perChannel?: boolean };

export function fakeConnection(
	profile: Profile,
	capabilities: Partial<PeqCapabilities> = {},
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
	return {
		device: {
			capabilities: {
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
				...capabilities
			},
			pull: async () => ({ filters: [], preamp: 0 }),
			push: async () => ({ reconnect: false }),
			currentSlot: async () => null,
			eqEnabled: async () => null,
			setEnabled: async () => {},
			firmware: async () => null,
			bandCount: async () => null,
			readControls: async () => ({}),
			writeControl: async () => ({ reconnect: false }),
			close: async () => {}
		},
		connectionType: 'hid',
		name: `${listed.device.brand} ${listed.device.model}`,
		profile: listed,
		profileSource: 'device',
		profileId: listed.id,
		identity: {}
	} as unknown as DeviceConnection;
}
