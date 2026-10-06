<template>
  <ion-item-group class="band">
    <ion-item lines="none">
      <ion-checkbox
        slot="start"
        :checked="filter.enabled"
        @ion-change="emitPatch({ enabled: $event.detail.checked })"
        aria-label="Band enabled"
      />
      <ion-select
        interface="popover"
        :value="filter.type"
        aria-label="Filter type"
        @ion-change="emitPatch({ type: $event.detail.value })"
      >
        <ion-select-option v-for="t in allowedTypes" :key="t" :value="t">{{ typeLabels[t] }}</ion-select-option>
      </ion-select>
      <ion-button slot="end" fill="clear" color="medium" @click="$emit('remove')" aria-label="Remove band">
        <ion-icon :icon="closeOutline" />
      </ion-button>
    </ion-item>
    <ion-item lines="none" class="param-row">
      <div class="param">
        <ion-label position="stacked">Freq (Hz)</ion-label>
        <ion-input
          type="number"
          :min="minFreq" :max="maxFreq"
          :value="filter.freq"
          @ion-change="emitNumber('freq', $event.detail.value, minFreq, maxFreq)"
        />
      </div>
      <div class="param">
        <ion-label position="stacked">Gain (dB)</ion-label>
        <ion-input
          type="number" step="0.1"
          :min="constraints.minGain" :max="constraints.maxGain"
          :value="filter.gain"
          @ion-change="emitNumber('gain', $event.detail.value, constraints.minGain, constraints.maxGain)"
        />
      </div>
      <div class="param">
        <ion-label position="stacked">Q</ion-label>
        <ion-input
          type="number" step="0.1"
          :min="constraints.minQ" :max="constraints.maxQ"
          :value="filter.q"
          @ion-change="emitNumber('q', $event.detail.value, constraints.minQ, constraints.maxQ)"
        />
      </div>
    </ion-item>
    <ion-item lines="full" class="slider-row">
      <ion-range
        :min="constraints.minGain" :max="constraints.maxGain" :step="0.5"
        :value="filter.gain"
        aria-label="Gain slider"
        @ion-knob-move-start="$emit('gesture-start')"
        @ion-knob-move-end="emitPatch({ gain: Number($event.detail.value) }, true)"
      >
        <ion-label slot="start">{{ constraints.minGain }}</ion-label>
        <ion-label slot="end">+{{ constraints.maxGain }}</ion-label>
      </ion-range>
    </ion-item>
  </ion-item-group>
</template>

<script setup lang="ts">
import {
  IonButton, IonCheckbox, IonIcon, IonInput, IonItem, IonItemGroup, IonLabel,
  IonRange, IonSelect, IonSelectOption,
} from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import { computed } from 'vue';
import type { Filter, FilterType, PeqConstraints } from '@/core/model/types';

const props = defineProps<{
  filter: Filter;
  constraints: PeqConstraints;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Partial<Filter>, skipHistory?: boolean): void;
  (e: 'remove'): void;
  (e: 'gesture-start'): void;
}>();

const typeLabels: Record<FilterType, string> = {
  PK: 'Peak', LSQ: 'Low shelf', HSQ: 'High shelf', LPF: 'Low pass', HPF: 'High pass',
  BPF: 'Band pass', NOTCH: 'Notch', APF: 'All pass', BSF: 'Band stop', CQ: 'Const Q',
};

const allowedTypes = computed<FilterType[]>(() => {
  const c = props.constraints;
  const types: FilterType[] = ['PK'];
  if (c.supportsLSFilter) types.push('LSQ');
  if (c.supportsHSFilter) types.push('HSQ');
  if (c.supportsLPFilter) types.push('LPF');
  if (c.supportsHPFilter) types.push('HPF');
  if (c.supportsBPFilter) types.push('BPF');
  if (c.supportsNotchFilter) types.push('NOTCH');
  if (c.supportsAllPassFilter) types.push('APF');
  if (c.supportsBandStopFilter) types.push('BSF');
  if (c.supportsConstantQFilter) types.push('CQ');
  return types;
});

const minFreq = computed(() => props.constraints.minFreq ?? 20);
const maxFreq = computed(() => props.constraints.maxFreq ?? 20000);

function emitPatch(patch: Partial<Filter>, skipHistory = false) {
  emit('patch', patch, skipHistory);
}

function emitNumber(key: 'freq' | 'gain' | 'q', value: string | number | null | undefined, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : parseFloat(value ?? '');
  if (Number.isNaN(parsed)) return;
  emitPatch({ [key]: Math.min(Math.max(parsed, min), max) });
}
</script>

<style scoped>
.band {
  border-bottom: 1px solid var(--ion-color-step-150, #e0e0e0);
}
.param-row::part(native) {
  align-items: flex-end;
}
.param {
  flex: 1;
  padding-right: 8px;
}
.slider-row ion-range {
  --bar-height: 3px;
}
</style>
