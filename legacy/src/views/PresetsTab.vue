<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Presets</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="presets.search"
          placeholder="Search name or tag"
          @ion-input="presets.search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item v-for="entry in presets.filteredIndex" :key="entry.id">
          <ion-label>
            <h2>{{ entry.name }}</h2>
            <p>
              {{ entry.tags.join(', ') || 'no tags' }} ·
              updated {{ entry.updatedAt.slice(0, 10) }}
              <ion-text v-if="compatibility[entry.id] !== undefined" :color="compatColor(compatibility[entry.id])">
                · {{ compatLabel(compatibility[entry.id]) }}
              </ion-text>
            </p>
          </ion-label>
          <ion-button v-if="device.connected" slot="end" size="small" fill="outline" @click="onApply(entry.id)">
            Apply
          </ion-button>
          <ion-button slot="end" size="small" fill="clear" @click="onActions(entry.id, entry.name)">
            <ion-icon slot="icon-only" :icon="ellipsisVerticalOutline" />
          </ion-button>
        </ion-item>
        <ion-item v-if="presets.filteredIndex.length === 0" lines="none">
          <ion-label color="medium" class="ion-text-wrap">
            No presets yet. Save one from the Main tab, or import a preset JSON /
            AutoEq ParametricEQ txt file below.
          </ion-label>
        </ion-item>
      </ion-list>

      <div class="ion-padding">
        <ion-button fill="outline" size="small" @click="fileInput?.click()">
          <ion-icon slot="start" :icon="downloadOutline" />Import
        </ion-button>
        <input
          ref="fileInput"
          type="file"
          accept=".json,.txt"
          style="display: none"
          @change="onImportFile"
        />
        <ion-text color="danger" v-if="error"><p>{{ error }}</p></ion-text>
      </div>

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
  IonButton, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal,
  IonPage, IonSearchbar, IonText, IonTitle, IonToolbar, actionSheetController, alertController,
} from '@ionic/vue';
import { downloadOutline, ellipsisVerticalOutline } from 'ionicons/icons';
import { onMounted, ref, watch } from 'vue';
import PresetDiffModal from '@/components/PresetDiffModal.vue';
import { adaptPresetToConstraints, type AdaptationResult } from '@/core/adaptation/adaptPreset';
import { useDeviceStore } from '@/stores/deviceStore';
import { useEqStore } from '@/stores/eqStore';
import { usePresetStore } from '@/stores/presetStore';

const presets = usePresetStore();
const device = useDeviceStore();
const eq = useEqStore();

const fileInput = ref<HTMLInputElement>();
const error = ref('');
const diff = ref<{ presetName: string; result: AdaptationResult } | null>(null);
/** presetId → lossScore vs the currently connected device. */
const compatibility = ref<Record<string, number>>({});

function compatLabel(loss: number) {
  return loss === 0 ? 'perfect fit' : loss <= 3 ? 'minor changes' : 'lossy fit';
}
function compatColor(loss: number) {
  return loss === 0 ? 'success' : loss <= 3 ? 'warning' : 'danger';
}

async function refreshCompatibility() {
  compatibility.value = {};
  if (!device.profile) return;
  const scores: Record<string, number> = {};
  for (const entry of presets.index) {
    const preset = await presets.load(entry.id);
    if (preset) scores[entry.id] = adaptPresetToConstraints(preset, device.profile.constraints).lossScore;
  }
  compatibility.value = scores;
}

async function onApply(id: string) {
  const preset = await presets.load(id);
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

async function onActions(id: string, name: string) {
  const sheet = await actionSheetController.create({
    header: name,
    buttons: [
      { text: 'Rename', handler: () => void onRename(id) },
      { text: 'Duplicate', handler: () => void presets.duplicate(id).then(refreshCompatibility) },
      { text: 'Export', handler: () => void onExport(id, name) },
      { text: 'Delete', role: 'destructive', handler: () => void presets.remove(id).then(refreshCompatibility) },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function onRename(id: string) {
  const preset = await presets.load(id);
  if (!preset) return;
  const alert = await alertController.create({
    header: 'Rename preset',
    inputs: [{ name: 'name', type: 'text', value: preset.name }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Save',
        handler: (data: { name?: string }) => {
          const name = data.name?.trim();
          if (!name) return false;
          void presets.update({ ...preset, name });
          return true;
        },
      },
    ],
  });
  await alert.present();
}

async function onExport(id: string, name: string) {
  const json = await presets.exportPreset(id);
  if (!json) return;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '_')}.unipeq.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(event: Event) {
  error.value = '';
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    await presets.importText(await file.text(), file.name);
    await refreshCompatibility();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(async () => {
  await presets.refresh();
  await refreshCompatibility();
});

watch(() => device.profile?.id, refreshCompatibility);
watch(() => presets.index, refreshCompatibility);
</script>
