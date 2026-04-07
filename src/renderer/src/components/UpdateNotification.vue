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
    <v-banner v-if="isVisible" color="primary" stacked>
      <span v-if="status === 'available'">{{ t('update.available', { version: versionLabel }) }}</span>
      <div v-if="status === 'downloading'">
        <span>{{ t('update.downloading') }}</span>
        <v-progress-linear :model-value="progress" color="white" class="mt-1" />
        <span class="text-caption">{{ Math.round(progress) }}%</span>
      </div>
      <span v-if="status === 'downloaded'">{{ t('update.ready', { version: versionLabel }) }}</span>
      <span v-if="status === 'error'">{{ t('update.error', { msg: errorMessage ?? '' }) }}</span>
      <v-btn v-if="status === 'available'" variant="outlined" @click="download">
        {{ t('update.download') }}
      </v-btn>
      <v-btn v-if="status === 'downloaded'" variant="outlined" @click="install">
        {{ t('update.restart') }}
      </v-btn>
      <v-btn v-if="status === 'downloaded'" variant="text" @click="dismiss">
        {{ t('update.later') }}
      </v-btn>
      <v-btn v-if="status === 'error'" variant="text" @click="dismiss">✕</v-btn>
    </v-banner>
  </v-slide-y-transition>
</template>
