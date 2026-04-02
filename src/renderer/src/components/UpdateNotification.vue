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
  <Transition
    enter-active-class="notif-enter-active"
    leave-active-class="notif-leave-active"
    enter-from-class="notif-enter-from"
    leave-to-class="notif-leave-to"
  >
    <div v-if="isVisible" class="update-banner elevation-2">
      <!-- Available -->
      <template v-if="status === 'available'">
        <span class="banner-text">{{ t('update.available', { version: versionLabel }) }}</span>
        <button class="btn-banner-action" @click="download">
          {{ t('update.download') }}
        </button>
      </template>

      <!-- Downloading -->
      <template v-else-if="status === 'downloading'">
        <span class="banner-text">{{ t('update.downloading') }}</span>
        <div class="download-progress">
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: `${progress}%` }"
            />
          </div>
          <span class="progress-pct">{{ Math.round(progress) }}%</span>
        </div>
      </template>

      <!-- Downloaded -->
      <template v-else-if="status === 'downloaded'">
        <span class="banner-text">{{ t('update.ready', { version: versionLabel }) }}</span>
        <div class="banner-actions">
          <button class="btn-banner-action" @click="install">
            {{ t('update.restart') }}
          </button>
          <button class="btn-banner-dismiss" @click="dismiss">
            {{ t('update.later') }}
          </button>
        </div>
      </template>

      <!-- Error -->
      <template v-else-if="status === 'error'">
        <span class="banner-text banner-text--error">{{ t('update.error', { msg: errorMessage ?? '' }) }}</span>
        <button class="btn-banner-dismiss" @click="dismiss">✕</button>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
/* Transition — :global() needed: Transition system adds classes without scoped attr */
:global(.notif-enter-active) {
  transition: opacity 0.3s ease-out, max-height 0.3s ease-out;
  overflow: hidden;
}
:global(.notif-leave-active) {
  transition: opacity 0.2s ease-in, max-height 0.2s ease-in;
  overflow: hidden;
}
:global(.notif-enter-from),
:global(.notif-leave-to) {
  opacity: 0;
  max-height: 0;
}

.update-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background-color: #6d28d9;
  color: #fff;
  font-size: 0.875rem;
  flex-shrink: 0;
  max-height: 3rem;
}

.banner-text {
  flex: 1;
}
.banner-text--error {
  color: #fca5a5;
}

.btn-banner-action {
  margin-left: 16px;
  padding: 4px 12px;
  background-color: #fff;
  color: #6d28d9;
  border: none;
  border-radius: 4px;
  font-weight: 500;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s;
}
.btn-banner-action:hover {
  background-color: #ede9fe;
}

.btn-banner-dismiss {
  margin-left: 8px;
  padding: 4px 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 0.15s;
}
.btn-banner-dismiss:hover {
  color: #fff;
}

.download-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
}

.progress-track {
  width: 8rem;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #fff;
  border-radius: 9999px;
  transition: width 0.3s;
}

.progress-pct {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
}
</style>
