<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="main" href="/tabs/main">
          <ion-icon aria-hidden="true" :icon="optionsOutline" />
          <ion-label>Main</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="presets" href="/tabs/presets">
          <ion-icon aria-hidden="true" :icon="albumsOutline" />
          <ion-label>Presets</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon aria-hidden="true" :icon="settingsOutline" />
          <ion-label>Settings</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { IonTabBar, IonTabButton, IonTabs, IonLabel, IonIcon, IonPage, IonRouterOutlet } from '@ionic/vue';
import { albumsOutline, optionsOutline, settingsOutline } from 'ionicons/icons';
</script>
