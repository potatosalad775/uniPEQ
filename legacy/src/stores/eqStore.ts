import { defineStore } from 'pinia';
import type { EqState, Filter } from '@/core/model/types';
import { AutoPushScheduler, type SyncStatus } from '@/services/autoPushScheduler';
import { UndoRedoStack } from '@/services/undoRedoStack';
import { deviceManager } from '@/services/deviceManager';
import { logger } from '@/services/logger';
import { useDeviceStore } from './deviceStore';
import { useSettingsStore } from './settingsStore';

interface EqStoreState {
  filters: Filter[];
  pregain: number;
  eqEnabled: boolean;
  dirty: boolean;
  syncStatus: SyncStatus;
  canUndo: boolean;
  canRedo: boolean;
  pulling: boolean;
}

const history = new UndoRedoStack();
let scheduler: AutoPushScheduler | undefined;

export const useEqStore = defineStore('eq', {
  state: (): EqStoreState => ({
    filters: [],
    pregain: 0,
    eqEnabled: true,
    dirty: false,
    syncStatus: 'idle',
    canUndo: false,
    canRedo: false,
    pulling: false,
  }),

  getters: {
    snapshot(state): EqState {
      return { filters: state.filters.map((f) => ({ ...f })), pregain: state.pregain };
    },
  },

  actions: {
    initScheduler() {
      const settings = useSettingsStore();
      scheduler = new AutoPushScheduler(
        () => this.pushToDevice(),
        (status) => {
          this.syncStatus = status;
        },
        settings.autoPushDelayMs,
      );
      scheduler.setEnabled(settings.autoPushEnabled && !useDeviceStore().manualPushMode);
    },

    reconfigureScheduler() {
      const settings = useSettingsStore();
      if (!scheduler) return;
      scheduler.delayMs = settings.autoPushDelayMs;
      scheduler.setEnabled(settings.autoPushEnabled && !useDeviceStore().manualPushMode);
    },

    /** Snapshot BEFORE a user edit (call on gesture start / control commit). */
    recordHistory() {
      history.record(this.snapshot);
      this.refreshHistoryFlags();
    },

    /** Call after any EQ mutation to mark dirty + kick the auto-push debounce. */
    markDirty() {
      this.dirty = true;
      scheduler?.notifyChange();
    },

    /** `record=false` when the gesture already snapshotted (slider drags). */
    updateFilter(index: number, patch: Partial<Filter>, record = true) {
      if (!this.filters[index]) return;
      if (record) this.recordHistory();
      Object.assign(this.filters[index], patch);
      this.markDirty();
    },

    addFilter() {
      const device = useDeviceStore();
      const max = device.profile?.constraints.maxFilters ?? 10;
      if (this.filters.length >= max) return;
      this.recordHistory();
      this.filters.push({ type: 'PK', freq: 1000, gain: 0, q: 1, enabled: true });
      this.markDirty();
    },

    removeFilter(index: number) {
      this.recordHistory();
      this.filters.splice(index, 1);
      this.markDirty();
    },

    setPregain(value: number) {
      this.recordHistory();
      this.pregain = value;
      this.markDirty();
    },

    applyState(state: EqState) {
      this.recordHistory();
      this.filters = state.filters.map((f) => ({ ...f }));
      this.pregain = state.pregain;
      this.markDirty();
    },

    undo() {
      const previous = history.undo(this.snapshot);
      if (previous) {
        this.filters = previous.filters;
        this.pregain = previous.pregain;
        this.markDirty();
      }
      this.refreshHistoryFlags();
    },

    redo() {
      const next = history.redo(this.snapshot);
      if (next) {
        this.filters = next.filters;
        this.pregain = next.pregain;
        this.markDirty();
      }
      this.refreshHistoryFlags();
    },

    refreshHistoryFlags() {
      this.canUndo = history.canUndo;
      this.canRedo = history.canRedo;
    },

    clearSession() {
      history.clear();
      this.refreshHistoryFlags();
      this.filters = [];
      this.pregain = 0;
      this.dirty = false;
      this.syncStatus = 'idle';
    },

    async pullFromDevice() {
      const device = useDeviceStore();
      if (!device.connected) return;
      this.pulling = true;
      try {
        const result = await deviceManager.pull(device.currentSlot);
        device.writeOnly = result.writeOnly === true;
        if (!result.writeOnly) {
          this.filters = result.filters.map((f) => ({ ...f }));
          this.pregain = result.globalGain;
        }
        this.dirty = false;
        this.syncStatus = 'synced';
        history.clear();
        this.refreshHistoryFlags();
      } catch (e) {
        logger.error('pullFromDevice failed:', (e as Error).message);
        this.syncStatus = 'error';
      } finally {
        this.pulling = false;
      }
    },

    async pushToDevice() {
      const device = useDeviceStore();
      if (!device.connected) return;
      const slot = device.currentSlot;
      const writable = device.writableSlotIds;
      const targetSlot = writable.has(slot) ? slot : writable.values().next().value;
      if (targetSlot === undefined) {
        logger.warn('No writable slot available on this device');
        this.syncStatus = 'error';
        return;
      }
      await deviceManager.push(targetSlot, this.pregain, this.filters);
      if (targetSlot !== slot) await device.selectSlot(targetSlot);
      this.dirty = false;
    },

    async manualSave() {
      this.syncStatus = 'pushing';
      try {
        await this.pushToDevice();
        this.syncStatus = 'synced';
      } catch (e) {
        logger.error('manualSave failed:', (e as Error).message);
        this.syncStatus = 'error';
      }
    },

    async toggleEq(enabled: boolean) {
      const device = useDeviceStore();
      if (!device.connected) return;
      try {
        await deviceManager.enablePEQ(enabled, device.currentSlot);
        this.eqEnabled = enabled;
      } catch (e) {
        logger.error('toggleEq failed:', (e as Error).message);
      }
    },
  },
});
