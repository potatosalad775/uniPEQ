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
				readsEnabled: false,
				canEnable: false,
				slots: [],
				disconnectOnSave: false,
				experimental: false,
				readsFirmware: false,
				controls: [],
				...capabilities
			},
			pull: async () => ({ filters: [], preamp: 0 }),
			push: async () => ({ reconnect: false }),
			currentSlot: async () => null,
			eqEnabled: async () => null,
			setEnabled: async () => {},
			firmware: async () => null,
			readControls: async () => ({}),
			writeControl: async () => ({ reconnect: false }),
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
