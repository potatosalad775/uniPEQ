import { Capacitor } from '@capacitor/core';
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router';
import { useSettingsStore } from './stores/settingsStore';
import type { HidSpikeOptions } from './transports/native/hidSpike';

import { IonicVue } from '@ionic/vue';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* Class-based so the Settings theme selector controls it (see settingsStore.applyTheme) */
import '@ionic/vue/css/palettes/dark.class.css';

/* Theme variables */
import './theme/variables.css';

const app = createApp(App)
  .use(IonicVue)
  .use(createPinia())
  .use(router);

router.isReady().then(() => {
  app.mount('#app');
  useSettingsStore().persist(); // applies theme + verbose-logging flag on boot
});

// Phase 0 USB HID spike (docs/rebuild-plan.md), driven by scripts/android-hid-spike.mjs. Not UI.
if (Capacitor.isNativePlatform()) {
  Object.assign(window, {
    uniPeqHidSpike: (options?: HidSpikeOptions) =>
      import('./transports/native/hidSpike').then((m) => m.runHidSpike(options)),
  });
}
