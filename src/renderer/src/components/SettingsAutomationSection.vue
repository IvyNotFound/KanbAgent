<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const store = useTasksStore()
</script>

<template>
  <v-sheet rounded="lg" border class="pa-4">
    <div class="d-flex align-center justify-space-between ga-4">
      <div>
        <p class="text-body-2 font-weight-medium">{{ t('settings.autoLaunch') }}</p>
        <p class="text-body-2 text-medium-emphasis">{{ t('settings.autoLaunchDesc') }}</p>
      </div>
      <v-switch
        hide-details
        density="compact"
        color="primary"
        :model-value="settingsStore.autoLaunchAgentSessions"
        @update:model-value="settingsStore.setAutoLaunchAgentSessions(Boolean($event))"
      />
    </div>
  </v-sheet>
  <v-sheet rounded="lg" border class="pa-4">
    <div class="d-flex align-center justify-space-between ga-4">
      <div>
        <p class="text-body-2 font-weight-medium">{{ t('settings.autoReview') }}</p>
        <p class="text-body-2 text-medium-emphasis">{{ t('settings.autoReviewDesc') }}</p>
      </div>
      <v-switch
        hide-details
        density="compact"
        color="primary"
        :model-value="settingsStore.autoReviewEnabled"
        @update:model-value="settingsStore.setAutoReviewEnabled(Boolean($event))"
      />
    </div>
    <div v-if="settingsStore.autoReviewEnabled" class="d-flex align-center ga-2 mt-3">
      <label class="text-body-2 text-medium-emphasis">{{ t('settings.autoReviewThreshold') }}</label>
      <v-text-field
        type="number"
        :model-value="settingsStore.autoReviewThreshold"
        :min="3"
        :max="100"
        variant="outlined"
        density="compact"
        hide-details
        style="width: 80px"
        @update:model-value="(v) => settingsStore.setAutoReviewThreshold(Number(v))"
      />
    </div>
  </v-sheet>
  <v-sheet rounded="lg" border class="pa-4">
    <div class="d-flex align-center justify-space-between ga-4">
      <div>
        <p class="text-body-2 font-weight-medium">{{ t('settings.worktreeDefault') }}</p>
        <p class="text-body-2 text-medium-emphasis">{{ t('settings.worktreeDefaultDesc') }}</p>
      </div>
      <v-switch
        hide-details
        density="compact"
        color="primary"
        :model-value="settingsStore.worktreeDefault"
        @update:model-value="store.dbPath && settingsStore.setWorktreeDefault(store.dbPath, Boolean($event))"
      />
    </div>
  </v-sheet>
</template>
