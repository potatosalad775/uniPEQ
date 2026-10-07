/**
 * A connection to a device that does nothing, for specs that need a profile to be the active
 * constraint (`devicePeqStore.setConnected(fakeConnection(profile), null)`).
 */
import type { Profile } from '@potatosalad775/eqcaps-core';
import type { DeviceConnection, PeqCapabilities } from '../types';

export function fakeConnection(
	profile: Profile,
	capabilities: Partial<PeqCapabilities> = {}
): DeviceConnection {
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
				canEnable: false,
				slots: [],
				disconnectOnSave: false,
				experimental: false,
				...capabilities
			},
			pull: async () => ({ filters: [], preamp: 0 }),
			push: async () => ({ reconnect: false }),
			currentSlot: async () => null,
			setEnabled: async () => {},
			close: async () => {}
		},
		connectionType: 'hid',
		name: `${profile.device.brand} ${profile.device.model}`,
		profile,
		profileSource: 'device',
		profileId: profile.id,
		identity: {}
	} as unknown as DeviceConnection;
}
