<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-list-header><ion-label>Appearance</ion-label></ion-list-header>
        <ion-item>
          <ion-select
            label="Theme"
            interface="popover"
            :value="settings.theme"
            @ion-change="settings.theme = $event.detail.value; settings.persist()"
          >
            <ion-select-option value="system">System</ion-select-option>
            <ion-select-option value="light">Light</ion-select-option>
            <ion-select-option value="dark">Dark</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select
            label="Language"
            interface="popover"
            :value="settings.language"
            @ion-change="settings.language = $event.detail.value; settings.persist()"
          >
            <ion-select-option value="en">English</ion-select-option>
            <ion-select-option value="ko">한국어 (coming soon)</ion-select-option>
          </ion-select>
        </ion-item>

        <ion-list-header><ion-label>Auto-push</ion-label></ion-list-header>
        <ion-item>
          <ion-toggle
            :checked="settings.autoPushEnabled"
            @ion-change="onAutoPushToggle($event.detail.checked)"
          >Push changes automatically</ion-toggle>
        </ion-item>
        <ion-item :disabled="!settings.autoPushEnabled">
          <ion-range
            label="Delay"
            :min="500" :max="5000" :step="250"
            :value="settings.autoPushDelayMs"
            @ion-knob-move-end="onDelayChange(Number($event.detail.value))"
          >
            <ion-label slot="end">{{ (settings.autoPushDelayMs / 1000).toFixed(2) }} s</ion-label>
          </ion-range>
        </ion-item>

        <ion-list-header><ion-label>Diagnostics</ion-label></ion-list-header>
        <ion-item>
          <ion-toggle
            :checked="settings.verboseLogging"
            @ion-change="settings.verboseLogging = $event.detail.checked; settings.persist()"
          >Verbose byte-level logging</ion-toggle>
        </ion-item>
        <ion-item button @click="logOpen = true">
          <ion-label>View log ({{ logger.entries.length }} entries)</ion-label>
        </ion-item>
        <ion-item button @click="exportLog">
          <ion-label>Export log</ion-label>
        </ion-item>

        <ion-list-header><ion-label>About</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <h2>uniPEQ 0.0.1 (prototype)</h2>
            <p>Device DB: {{ deviceCount }} devices, {{ profileCount }} constraint profiles.</p>
            <p>Protocol handlers ported from the devicePEQ CrinGraph plugin (Pragmatic Audio).</p>
          </ion-label>
        </ion-item>
      </ion-list>

      <ion-modal :is-open="logOpen" @did-dismiss="logOpen = false">
        <ion-header>
          <ion-toolbar>
            <ion-title>Log</ion-title>
            <ion-buttons slot="end">
              <ion-button @click="logger.clear()">Clear</ion-button>
              <ion-button @click="logOpen = false">Close</ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <pre class="log-view">{{ logger.export() || '(empty)' }}</pre>
        </ion-content>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList,
  IonListHeader, IonModal, IonPage, IonRange, IonSelect, IonSelectOption,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/vue';
import { ref } from 'vue';
import { getRegistry } from '@/core/registry';
import { logger } from '@/services/logger';
import { useEqStore } from '@/stores/eqStore';
import { useSettingsStore } from '@/stores/settingsStore';

const settings = useSettingsStore();
const eq = useEqStore();
const logOpen = ref(false);

const registry = getRegistry();
const deviceCount = registry.devices.size;
const profileCount = registry.profiles.size;

function onAutoPushToggle(enabled: boolean) {
  settings.autoPushEnabled = enabled;
  settings.persist();
  eq.reconfigureScheduler();
}

function onDelayChange(value: number) {
  settings.autoPushDelayMs = value;
  settings.persist();
  eq.reconfigureScheduler();
}

function exportLog() {
  const blob = new Blob([logger.export()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unipeq-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.log-view {
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
