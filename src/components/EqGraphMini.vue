<template>
  <canvas ref="canvas" class="eq-graph" @click="draw"></canvas>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { Filter } from '@/core/model/types';
import { combinedResponseDb, logFreqGrid } from '@/core/math/biquad';

const props = defineProps<{
  filters: Filter[];
  pregain: number;
  minGain?: number;
  maxGain?: number;
}>();

const canvas = ref<HTMLCanvasElement>();

function draw() {
  const el = canvas.value;
  if (!el) return;
  const dpr = window.devicePixelRatio || 1;
  const width = el.clientWidth || 320;
  const height = el.clientHeight || 120;
  el.width = width * dpr;
  el.height = height * dpr;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const lo = props.minGain ?? -15;
  const hi = props.maxGain ?? 15;
  const yOf = (db: number) => height - ((db - lo) / (hi - lo)) * height;

  const styles = getComputedStyle(document.documentElement);
  const gridColor = styles.getPropertyValue('--ion-color-medium') || '#888';
  const lineColor = styles.getPropertyValue('--ion-color-primary') || '#3880ff';

  // 0 dB line + decade gridlines (100 Hz, 1 kHz, 10 kHz).
  ctx.strokeStyle = gridColor;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, yOf(0));
  ctx.lineTo(width, yOf(0));
  for (const f of [100, 1000, 10000]) {
    const x = (Math.log(f / 20) / Math.log(20000 / 20)) * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const freqs = logFreqGrid(Math.max(64, Math.floor(width / 2)));
  const response = combinedResponseDb(props.filters, freqs).map((db) => db + props.pregain);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  response.forEach((db, i) => {
    const x = (i / (response.length - 1)) * width;
    const y = Math.min(Math.max(yOf(db), -2), height + 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

onMounted(draw);
watch(() => [props.filters, props.pregain], draw, { deep: true });
</script>

<style scoped>
.eq-graph {
  width: 100%;
  height: 120px;
  display: block;
  border-radius: 8px;
  background: var(--ion-color-light, #f4f5f8);
}
</style>
