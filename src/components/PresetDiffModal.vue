<template>
  <ion-header>
    <ion-toolbar>
      <ion-title>Apply "{{ presetName }}"</ion-title>
      <ion-buttons slot="end">
        <ion-button @click="$emit('cancel')">Close</ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>
  <ion-content class="ion-padding">
    <template v-if="changes.length === 0">
      <ion-text color="success">
        <p>Preset fits this device perfectly — no changes needed.</p>
      </ion-text>
    </template>
    <template v-else>
      <ion-text>
        <p>
          The preset doesn't fully fit this device. It will be adapted
          (loss score {{ lossScore }}):
        </p>
      </ion-text>
      <ion-list>
        <ion-item v-for="(change, i) in changes" :key="i" lines="none">
          <ion-icon
            slot="start"
            :icon="warningIcon(change)"
            :color="change.loss > 2 ? 'danger' : change.loss > 0 ? 'warning' : 'medium'"
          />
          <ion-label class="ion-text-wrap">{{ change.message }}</ion-label>
        </ion-item>
      </ion-list>
    </template>
    <ion-button expand="block" @click="$emit('apply')">Apply</ion-button>
    <ion-button expand="block" fill="outline" color="medium" @click="$emit('cancel')">Cancel</ion-button>
  </ion-content>
</template>

<script setup lang="ts">
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel,
  IonList, IonText, IonTitle, IonToolbar,
} from '@ionic/vue';
import { alertCircleOutline, informationCircleOutline } from 'ionicons/icons';
import type { AdaptationChange } from '@/core/adaptation/adaptPreset';

defineProps<{
  presetName: string;
  changes: AdaptationChange[];
  lossScore: number;
}>();

defineEmits<{ (e: 'apply'): void; (e: 'cancel'): void }>();

function warningIcon(change: AdaptationChange) {
  return change.loss > 0 ? alertCircleOutline : informationCircleOutline;
}
</script>
