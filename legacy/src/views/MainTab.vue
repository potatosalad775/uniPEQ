<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>uniPEQ</ion-title>
        <ion-buttons slot="end" v-if="device.connected">
          <ion-chip :color="statusColor" class="sync-chip">{{ statusLabel }}</ion-chip>
          <ion-button @click="onDisconnect" color="medium">Disconnect</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- ── Connection area ─────────────────────────────────────────── -->
      <template v-if="!device.connected">
        <ion-list>
          <ion-list-header>
            <ion-label>Devices</ion-label>
            <ion-button size="small" @click="device.refreshCandidates()">Refresh</ion-button>
          </ion-list-header>
          <ion-item
            v-for="candidate in device.candidates"
            :key="candidate.key"
            button
            :detail="true"
            :disabled="device.connecting"
            @click="onConnect(candidate)"
          >
            <ion-icon slot="start" :icon="candidateIcon(candidate)" />
            <ion-label>
              <h2>{{ candidate.label }}</h2>
              <p>
                {{ candidate.profiles[0].brand }} ·
                {{ candidate.transportKind === 'demo' ? 'virtual device' : 'USB HID' }}
                <ion-text v-if="candidate.profiles[0].status === 'experimental'" color="warning">
                  · experimental</ion-text>
              </p>
            </ion-label>
          </ion-item>
          <ion-item button @click="onAddUsb" :disabled="!webHidAvailable">
            <ion-icon slot="start" :icon="addOutline" />
            <ion-label>
              <h2>Add USB device…</h2>
              <p v-if="!webHidAvailable">WebHID not available in this browser</p>
              <p v-else>Opens the browser device picker</p>
            </ion-label>
          </ion-item>
        </ion-list>
        <ion-text color="danger" v-if="device.error">
          <p class="ion-padding-horizontal">{{ device.error }}</p>
        </ion-text>
      </template>

      <!-- ── EQ control panel ────────────────────────────────────────── -->
      <template v-else>
        <ion-list>
          <ion-item lines="none">
            <ion-label>
              <h2>{{ device.profile!.name }}</h2>
              <p>{{ device.profile!.brand }} · {{ constraints.maxFilters }} bands ·
                {{ constraints.minGain }}…+{{ constraints.maxGain }} dB</p>
            </ion-label>
            <ion-toggle
              :checked="eq.eqEnabled"
              @ion-change="eq.toggleEq($event.detail.checked)"
            >EQ</ion-toggle>
          </ion-item>

          <ion-item v-if="device.writeOnly" color="warning" lines="none">
            <ion-label class="ion-text-wrap">
              Write-only device: current state can't be read back.
            </ion-label>
          </ion-item>

          <ion-item>
            <ion-select
              label="Slot"
              interface="popover"
              :value="device.currentSlot"
              @ion-change="onSlotChange($event.detail.value)"
            >
              <ion-select-option v-for="slot in device.availableSlots" :key="slot.id" :value="slot.id">
                {{ slot.name }}{{ device.writableSlotIds.has(slot.id) ? ' ✎' : '' }}
              </ion-select-option>
            </ion-select>
            <ion-button slot="end" fill="outline" size="small" @click="eq.pullFromDevice()" :disabled="eq.pulling">
              {{ eq.pulling ? 'Reading…' : 'Read from device' }}
            </ion-button>
          </ion-item>
        </ion-list>

        <div class="ion-padding-horizontal">
          <EqGraphMini
            :filters="eq.filters"
            :pregain="constraints.deviceHandlesPregain ? 0 : eq.pregain"
            :min-gain="constraints.minGain - 3"
            :max-gain="constraints.maxGain + 3"
          />
        </div>

        <ion-item v-if="!constraints.deviceHandlesPregain">
          <ion-range
            label="Pregain"
            :min="constraints.minGain" :max="0" :step="0.5"
            :value="eq.pregain"
            @ion-knob-move-start="eq.recordHistory()"
            @ion-knob-move-end="onPregain(Number($event.detail.value))"
          >
            <ion-label slot="end">{{ eq.pregain.toFixed(1) }} dB</ion-label>
          </ion-range>
        </ion-item>

        <EqBandControl
          v-for="(filter, i) in eq.filters"
          :key="i"
          :filter="filter"
          :constraints="constraints"
          @patch="(patch, skipHistory) => eq.updateFilter(i, patch, !skipHistory)"
          @remove="eq.removeFilter(i)"
          @gesture-start="eq.recordHistory()"
        />

        <div class="ion-padding action-row">
          <ion-button fill="outline" size="small" @click="eq.addFilter()"
            :disabled="eq.filters.length >= constraints.maxFilters">
            <ion-icon slot="start" :icon="addOutline" />Band
          </ion-button>
          <ion-button fill="outline" size="small" @click="eq.undo()" :disabled="!eq.canUndo">
            <ion-icon slot="icon-only" :icon="arrowUndoOutline" />
          </ion-button>
          <ion-button fill="outline" size="small" @click="eq.redo()" :disabled="!eq.canRedo">
            <ion-icon slot="icon-only" :icon="arrowRedoOutline" />
          </ion-button>
          <ion-button fill="outline" size="small" @click="openPresetPicker">Load preset</ion-button>
          <ion-button fill="outline" size="small" @click="onSaveAsPreset">Save as preset</ion-button>
          <ion-button v-if="device.manualPushMode" size="small" color="primary" @click="eq.manualSave()">
            Save to device
          </ion-button>
        </div>
      </template>

      <!-- Preset picker -->
      <ion-modal :is-open="pickerOpen" @did-dismiss="pickerOpen = false">
        <ion-header>
          <ion-toolbar>
            <ion-title>Load preset</ion-title>
            <ion-buttons slot="end"><ion-button @click="pickerOpen = false">Close</ion-button></ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content>
          <ion-list>
            <ion-item v-for="entry in presets.index" :key="entry.id" button @click="onPickPreset(entry.id)">
              <ion-label>{{ entry.name }}</ion-label>
            </ion-item>
            <ion-item v-if="presets.index.length === 0" lines="none">
              <ion-label color="medium">No presets saved yet.</ion-label>
            </ion-item>
          </ion-list>
        </ion-content>
      </ion-modal>

      <!-- Adaptation diff -->
      <ion-modal :is-open="diff !== null" @did-dismiss="diff = null">
        <PresetDiffModal
          v-if="diff"
          :preset-name="diff.presetName"
          :changes="diff.result.changes"
          :loss-score="diff.result.lossScore"
          @apply="onApplyAdapted"
          @cancel="diff = null"
        />
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton, IonButtons, IonChip, IonContent, IonHeader, IonIcon, IonItem, IonLabel,
  IonList, IonListHeader, IonModal, IonPage, IonRange, IonSelect, IonSelectOption,
  IonText, IonTitle, IonToggle, IonToolbar, alertController,
} from '@ionic/vue';
import { addOutline, arrowRedoOutline, arrowUndoOutline, hardwareChipOutline, musicalNotesOutline } from 'ionicons/icons';
import { computed, onMounted, ref } from 'vue';
import EqBandControl from '@/components/EqBandControl.vue';
import EqGraphMini from '@/components/EqGraphMini.vue';
import PresetDiffModal from '@/components/PresetDiffModal.vue';
import { adaptPresetToConstraints, type AdaptationResult } from '@/core/adaptation/adaptPreset';
import { useDeviceStore } from '@/stores/deviceStore';
import { useEqStore } from '@/stores/eqStore';
import { usePresetStore } from '@/stores/presetStore';
import { webHidSupported } from '@/transports/web/discovery';
import type { ConnectionCandidate } from '@/services/deviceManager';

const device = useDeviceStore();
const eq = useEqStore();
const presets = usePresetStore();

const webHidAvailable = webHidSupported();
const pickerOpen = ref(false);
const diff = ref<{ presetName: string; result: AdaptationResult } | null>(null);

const constraints = computed(() => device.profile!.constraints);

const statusLabel = computed(() => ({
  idle: 'idle', editing: 'edited', pending: 'pending…', pushing: 'pushing…',
  synced: 'synced', error: 'error',
}[eq.syncStatus]));

const statusColor = computed(() => ({
  idle: 'medium', editing: 'warning', pending: 'warning', pushing: 'primary',
  synced: 'success', error: 'danger',
}[eq.syncStatus]));

function candidateIcon(candidate: ConnectionCandidate) {
  return candidate.transportKind === 'demo' ? musicalNotesOutline : hardwareChipOutline;
}

async function onConnect(candidate: ConnectionCandidate) {
  await device.connect(candidate);
  eq.clearSession();
  eq.initScheduler();
  await eq.pullFromDevice();
}

async function onAddUsb() {
  const candidate = await device.addHidDevice();
  if (candidate) await onConnect(candidate);
}

async function onDisconnect() {
  await device.disconnect();
  eq.clearSession();
}

async function onSlotChange(slotId: number) {
  await device.selectSlot(slotId);
  await eq.pullFromDevice();
}

function onPregain(value: number) {
  eq.pregain = value;
  eq.markDirty();
}

function openPresetPicker() {
  void presets.refresh();
  pickerOpen.value = true;
}

async function onPickPreset(id: string) {
  const preset = await presets.load(id);
  pickerOpen.value = false;
  if (!preset || !device.profile) return;
  diff.value = {
    presetName: preset.name,
    result: adaptPresetToConstraints(preset, device.profile.constraints),
  };
}

function onApplyAdapted() {
  if (!diff.value) return;
  eq.applyState(diff.value.result.adapted);
  diff.value = null;
}

async function onSaveAsPreset() {
  const alert = await alertController.create({
    header: 'Save as preset',
    inputs: [{ name: 'name', type: 'text', placeholder: 'Preset name' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Save',
        handler: (data: { name?: string }) => {
          const name = data.name?.trim();
          if (!name) return false;
          void presets.saveFromEqState(name, eq.snapshot, device.profile?.id);
          return true;
        },
      },
    ],
  });
  await alert.present();
}

onMounted(() => {
  void device.refreshCandidates();
});
</script>

<style scoped>
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sync-chip {
  pointer-events: none;
}
</style>
