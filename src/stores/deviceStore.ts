import { defineStore } from 'pinia';
import type { ResolvedDeviceProfile, Slot } from '@/core/model/types';
import { deviceManager, type ConnectionCandidate } from '@/services/deviceManager';
import { logger } from '@/services/logger';

interface DeviceState {
  candidates: ConnectionCandidate[];
  connecting: boolean;
  profile: ResolvedDeviceProfile | null;
  currentSlot: number;
  writeOnly: boolean;
  error: string | null;
}

export const useDeviceStore = defineStore('device', {
  state: (): DeviceState => ({
    candidates: [],
    connecting: false,
    profile: null,
    currentSlot: -1,
    writeOnly: false,
    error: null,
  }),

  getters: {
    connected: (state) => state.profile !== null,
    availableSlots(state): Slot[] {
      return state.profile?.modelConfig.availableSlots ?? [];
    },
    writableSlotIds(state): Set<number> {
      const mc = state.profile?.modelConfig;
      if (!mc) return new Set();
      const first = mc.firstWritableEQSlot ?? -1;
      const max = mc.maxWritableEQSlots ?? 0;
      const ids = new Set<number>();
      if (first < 0 || max <= 0) return ids;
      const slots = (mc.availableSlots ?? []).map((s) => s.id).sort((a, b) => a - b);
      for (const id of slots) {
        if (id >= first && ids.size < max && id !== mc.disabledPresetId) ids.add(id);
      }
      return ids;
    },
    /** disconnectOnSave / pushMode:"manual" devices get an explicit save button. */
    manualPushMode(state): boolean {
      const mc = state.profile?.modelConfig;
      return mc?.pushMode === 'manual' || mc?.disconnectOnSave === true;
    },
  },

  actions: {
    async refreshCandidates() {
      try {
        this.candidates = await deviceManager.listCandidates();
      } catch (e) {
        this.error = (e as Error).message;
      }
    },

    async addHidDevice() {
      this.error = null;
      try {
        const candidate = await deviceManager.requestNewHidDevice();
        if (candidate) {
          await this.refreshCandidates();
          return candidate;
        }
      } catch (e) {
        this.error = (e as Error).message;
        logger.error('addHidDevice failed:', (e as Error).message);
      }
      return undefined;
    },

    async connect(candidate: ConnectionCandidate, profileId?: string) {
      this.connecting = true;
      this.error = null;
      try {
        const connection = await deviceManager.connect(candidate, profileId);
        this.profile = connection.profile;
        deviceManager.onDisconnected = () => {
          this.profile = null;
          this.currentSlot = -1;
        };
        try {
          this.currentSlot = await deviceManager.getCurrentSlot();
        } catch {
          // Some devices don't answer slot queries; fall back to first writable.
          this.currentSlot = this.writableSlotIds.values().next().value ?? -1;
        }
        return connection;
      } catch (e) {
        this.error = (e as Error).message;
        logger.error('connect failed:', (e as Error).message);
        throw e;
      } finally {
        this.connecting = false;
      }
    },

    async disconnect() {
      await deviceManager.disconnect();
      this.profile = null;
      this.currentSlot = -1;
    },

    async selectSlot(slotId: number) {
      this.currentSlot = slotId;
    },
  },
});
