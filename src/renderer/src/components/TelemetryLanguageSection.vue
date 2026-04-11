<script setup lang="ts">
import { useSettingsStore } from '@renderer/stores/settings'
import { useI18n } from 'vue-i18n'
import { getLangColor } from '@renderer/utils/lang-colors'

const { t } = useI18n()
const settings = useSettingsStore()

interface LangStat {
  name: string
  files: number
  lines: number
  percent: number
  sourceLines?: number
  testLines?: number
}

defineProps<{
  languages: LangStat[]
  hasLangAdvanced: boolean
}>()
</script>

<template>
  <!-- Language bar (GitHub-style) -->
  <v-card elevation="0" class="telem-metric-card telem-section-card">
    <div class="telem-section-header">
      <span class="text-body-2 font-weight-medium telem-section-title">{{ t('telemetry.languageBreakdown') }}</span>
    </div>
    <div class="pa-4 d-flex flex-column ga-2">
      <div class="telem-lang-bar">
        <div
          v-for="lang in languages"
          :key="lang.name"
          :style="{ width: lang.percent + '%', backgroundColor: getLangColor(lang.name, settings.theme === 'dark') }"
          :title="`${lang.name} — ${lang.percent.toFixed(1)}%`"
          class="telem-lang-segment"
        />
      </div>
      <div class="telem-lang-legend mt-1">
        <div
          v-for="lang in languages"
          :key="lang.name"
          class="telem-lang-legend-item text-caption"
        >
          <span class="telem-dot" :style="{ backgroundColor: getLangColor(lang.name, settings.theme === 'dark') }" />
          {{ lang.name }}
          <span class="telem-subtle">{{ lang.percent.toFixed(1) }}%</span>
        </div>
      </div>
    </div>
  </v-card>

  <!-- Detailed table -->
  <v-card elevation="0" class="telem-metric-card telem-section-card">
    <div class="telem-section-header">
      <span class="text-body-2 font-weight-medium telem-section-title">{{ t('telemetry.languageDetail') }}</span>
    </div>
    <div class="telem-table-wrap text-body-2">
      <table class="telem-table text-body-2">
        <thead>
          <tr class="telem-thead-row text-label-medium">
            <th class="telem-th telem-th--left">{{ t('telemetry.colLanguage') }}</th>
            <th class="telem-th telem-th--right">{{ t('telemetry.colLines') }}</th>
            <th v-if="hasLangAdvanced" class="telem-th telem-th--right">{{ t('telemetry.colSource') }}</th>
            <th v-if="hasLangAdvanced" class="telem-th telem-th--right">{{ t('telemetry.colTests') }}</th>
            <th class="telem-th telem-th--right">{{ t('telemetry.colFiles') }}</th>
            <th class="telem-th telem-th--right">%</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lang in languages" :key="lang.name" class="telem-tbody-row">
            <td class="telem-td telem-td--lang ga-2">
              <span class="telem-dot" :style="{ backgroundColor: getLangColor(lang.name, settings.theme === 'dark') }" />
              <span class="telem-td-text">{{ lang.name }}</span>
            </td>
            <td class="telem-td telem-td--num telem-tertiary">{{ lang.lines.toLocaleString() }}</td>
            <td v-if="hasLangAdvanced" class="telem-td telem-td--num telem-value--green-soft">{{ (lang.sourceLines ?? 0).toLocaleString() }}</td>
            <td v-if="hasLangAdvanced" class="telem-td telem-td--num telem-value--amber-soft">{{ (lang.testLines ?? 0).toLocaleString() }}</td>
            <td class="telem-td telem-td--num telem-tertiary">{{ lang.files.toLocaleString() }}</td>
            <td class="telem-td telem-td--num telem-muted">{{ lang.percent.toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  </v-card>
</template>

<style scoped>
.telem-metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.telem-metric-card:hover {
  border-color: var(--edge-subtle) !important;
}
.telem-section-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.telem-section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.telem-section-title { color: var(--content-secondary); }
.telem-subtle { color: var(--content-subtle); }
.telem-muted { color: var(--content-muted); }
.telem-tertiary { color: var(--content-tertiary); }
.telem-value--green-soft { color: rgba(var(--v-theme-primary), 0.7); }
.telem-value--amber-soft { color: rgba(var(--v-theme-warning), 0.8); }

.telem-lang-bar {
  display: flex;
  height: 12px;
  border-radius: var(--shape-full);
  overflow: hidden;
  width: 100%;
}
.telem-lang-segment { transition: width var(--md-duration-medium2) var(--md-easing-standard); }
.telem-lang-legend {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 4px;
}
.telem-lang-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--content-muted);
}
.telem-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.telem-table-wrap { overflow-x: auto; }
.telem-table { width: 100%; border-collapse: collapse; }
.telem-thead-row {
  border-bottom: 1px solid var(--edge-default);
  color: var(--content-muted);
  letter-spacing: 0.02em;
}
.telem-th { padding: 10px 16px; font-weight: 600; }
.telem-th--left { text-align: left; }
.telem-th--right { text-align: right; }
.telem-tbody-row {
  border-bottom: 1px solid rgba(var(--v-theme-surface-tertiary), 0.5);
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.telem-tbody-row:last-child { border-bottom: none; }
.telem-tbody-row:hover { background: rgba(var(--v-theme-on-surface), var(--md-state-hover)); }
.telem-td { padding: 8px 16px; }
.telem-td--lang { display: flex; align-items: center; }
.telem-td--num { text-align: right; font-variant-numeric: tabular-nums; }
.telem-td-text { color: var(--content-secondary); }
</style>
