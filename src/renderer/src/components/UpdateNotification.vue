<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUpdater } from '@renderer/composables/useUpdater'

const { t } = useI18n()

const { status, progress, info, errorMessage, download, install, dismiss } = useUpdater()

const isVisible = computed(
  () =>
    status.value === 'available' ||
    status.value === 'downloading' ||
    status.value === 'downloaded' ||
    status.value === 'error',
)

const versionLabel = computed(() => (info.value?.version ? `v${info.value.version}` : ''))
</script>

<template>
  <v-slide-y-transition>
    <div v-if="isVisible" class="update-bar">
      <v-icon size="18">mdi-update</v-icon>

      <span v-if="status === 'available'" class="update-text">
        {{ t('update.available', { version: versionLabel }) }}
      </span>
      <span v-else-if="status === 'downloading'" class="update-text">
        {{ t('update.downloading') }}
      </span>
      <span v-else-if="status === 'downloaded'" class="update-text">
        {{ t('update.ready', { version: versionLabel }) }}
      </span>
      <span v-else-if="status === 'error'" class="update-text text-error">
        {{ t('update.error', { msg: errorMessage ?? '' }) }}
      </span>

      <v-progress-linear
        v-if="status === 'downloading'"
        :model-value="progress"
        color="on-primary"
        bg-color="rgba(255,255,255,0.25)"
        class="update-progress"
        rounded
      />
      <span v-if="status === 'downloading'" class="text-caption">
        {{ Math.round(progress) }}%
      </span>

      <v-spacer />

      <div class="update-actions">
        <v-btn v-if="status === 'available'" variant="outlined" size="small" @click="download">
          {{ t('update.download') }}
        </v-btn>
        <v-btn v-if="status === 'downloaded'" variant="outlined" size="small" @click="install">
          {{ t('update.restart') }}
        </v-btn>
        <v-btn v-if="status === 'downloaded'" variant="text" size="small" @click="dismiss">
          {{ t('update.later') }}
        </v-btn>
        <v-btn
          v-if="status === 'error'"
          variant="text"
          size="small"
          icon="mdi-close"
          density="compact"
          @click="dismiss"
        />
      </div>
    </div>
  </v-slide-y-transition>
</template>

<style scoped>
.update-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  flex-wrap: wrap;
}
.update-text {
  white-space: nowrap;
}
.update-progress {
  flex: 1;
  max-width: 200px;
  min-width: 80px;
}
.update-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
</style>
