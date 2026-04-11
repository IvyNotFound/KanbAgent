<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import { useUpdater } from '@renderer/composables/useUpdater'

const emit = defineEmits<{
  (e: 'export'): void
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()
const store = useTasksStore()
const { status: updaterStatus, check: checkUpdaterNow } = useUpdater()
</script>

<template>
  <v-sheet rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-3">{{ t('settings.updates') }}</p>
    <div class="d-flex align-center justify-space-between">
      <span class="text-body-2 text-medium-emphasis">
        {{ t('settings.version') }}: <code>{{ settingsStore.appInfo.version }}</code>
      </span>
      <v-btn
        color="primary"
        :disabled="updaterStatus === 'checking' || updaterStatus === 'downloading'"
        @click="checkUpdaterNow"
      >
        {{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}
      </v-btn>
    </div>
    <div v-if="updaterStatus !== 'idle' && updaterStatus !== 'checking'" class="mt-2">
      <span
        :class="[
          'text-body-2 font-weight-medium',
          (updaterStatus === 'available' || updaterStatus === 'downloaded') ? 'text-warning' :
          updaterStatus === 'up-to-date' ? 'text-secondary' :
          updaterStatus === 'error' ? 'text-error' : ''
        ]"
      >
        <template v-if="updaterStatus === 'up-to-date'">{{ t('settings.upToDate') }}</template>
        <template v-else-if="updaterStatus === 'available'">{{ t('settings.updateAvailable') }}</template>
        <template v-else-if="updaterStatus === 'downloading'">{{ t('settings.downloading') }}</template>
        <template v-else-if="updaterStatus === 'downloaded'">{{ t('settings.downloaded') }}</template>
        <template v-else-if="updaterStatus === 'error'">{{ t('settings.updateError') }}</template>
      </span>
    </div>
  </v-sheet>
  <v-sheet rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.about') }}</p>
    <p class="text-body-2 text-medium-emphasis">{{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}</p>
    <p class="text-body-2 text-medium-emphasis mt-1">{{ t('settings.aboutDesc') }}</p>
  </v-sheet>
  <v-sheet v-if="store.dbPath" rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-3">{{ t('settings.exportData') }}</p>
    <v-btn
      color="primary"
      prepend-icon="mdi-download"
      @click="emit('export')"
    >
      {{ t('settings.exportBtn') }}
    </v-btn>
  </v-sheet>
  <v-sheet v-if="store.dbPath" rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.database') }}</p>
    <p class="text-body-2 text-medium-emphasis" style="font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace; word-break: break-all;">{{ store.dbPath }}</p>
  </v-sheet>
</template>
