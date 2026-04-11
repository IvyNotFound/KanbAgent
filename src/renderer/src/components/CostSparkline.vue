<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  sparkPeriods: Array<{ label: string; cost: number }>
  sparkMax: number
  formatCost: (usd: number) => string
}>()

const hoveredBar = ref<number | null>(null)
</script>

<template>
  <div v-if="sparkPeriods.length > 1" class="cost-sparkline-section ga-1">
    <span class="cost-section-label text-label-medium">{{ t('costStats.trend') }}</span>
    <div class="cost-sparkline ga-1">
      <div
        v-for="(bar, i) in sparkPeriods"
        :key="bar.label"
        class="cost-spark-bar-wrap"
        @mouseenter="hoveredBar = i"
        @mouseleave="hoveredBar = null"
      >
        <div
          class="cost-spark-bar"
          :class="{ 'cost-spark-bar--hover': hoveredBar === i }"
          :style="{ height: Math.max(Math.round((bar.cost / sparkMax) * 36), bar.cost > 0 ? 2 : 0) + 'px' }"
        />
        <div v-if="bar.cost === 0" class="cost-spark-zero" />
        <div
          v-if="hoveredBar === i"
          class="cost-spark-tooltip elevation-2 py-1 px-2 text-label-medium"
        >
          {{ bar.label }} : {{ formatCost(bar.cost) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cost-sparkline-section {
  display: flex;
  flex-direction: column;
}
.cost-section-label {
  letter-spacing: 0.02em;
  color: var(--content-faint);
  display: block;
}
.cost-sparkline {
  display: flex;
  align-items: flex-end;
  height: 40px;
}
.cost-spark-bar-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  cursor: default;
}
.cost-spark-bar {
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: rgba(var(--v-theme-secondary), 0.5);
  transition: background-color var(--md-duration-short3) var(--md-easing-standard);
}
.cost-spark-bar--hover { background: rgb(var(--v-theme-secondary)); }
.cost-spark-zero {
  width: 100%;
  height: 2px;
  border-radius: 2px;
  background: var(--edge-subtle);
}
.cost-spark-tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  border-radius: var(--shape-xs);
  white-space: nowrap;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-default);
  pointer-events: none;
}
</style>
