<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import ToggleSwitch from '@renderer/components/ToggleSwitch.vue'
import CliDetectionList from '@renderer/components/CliDetectionList.vue'
import type { ClaudeInstance } from '@renderer/types'
import { useUpdater } from '@renderer/composables/useUpdater'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

// Export ZIP state
const showExportConfirm = ref(false)
const exporting = ref(false)

async function exportZip() {
  if (!store.dbPath) return
  exporting.value = true
  showExportConfirm.value = false
  try {
    const result = await window.electronAPI.projectExportZip(store.dbPath)
    if (result.success && result.path) {
      emit('toast', t('settings.exportSuccess', { path: result.path }), 'success')
    } else {
      emit('toast', t('settings.exportError', { error: result.error ?? 'Erreur inconnue' }), 'error')
    }
  } catch (err) {
    emit('toast', t('settings.exportError', { error: String(err) }), 'error')
  } finally {
    exporting.value = false
  }
}

const { t } = useI18n()
const settingsStore = useSettingsStore()
const store = useTasksStore()
const { status: updaterStatus, check: checkUpdaterNow } = useUpdater()

const availableLocales = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'no', label: 'Norsk' },
  { code: 'it', label: 'Italiano' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
  { code: 'fi', label: 'Suomi' },
  { code: 'da', label: 'Dansk' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
] as const

// Claude instances for default selection (T857)
const claudeInstances = ref<ClaudeInstance[]>([])

function instanceLabel(inst: ClaudeInstance): string {
  if (inst.distro === 'local') return `Local (v${inst.version})`
  return `${inst.distro}${inst.isDefault ? ' ★' : ''} (v${inst.version})`
}

onMounted(async () => {
  // Load Claude instances for default selection (T857)
  const rawInstances = await window.electronAPI.getClaudeInstances()
  claudeInstances.value = Array.isArray(rawInstances) ? (rawInstances as ClaudeInstance[]) : []

  // T1013: initial CLI detection (populates allCliInstances in store)
  await settingsStore.refreshCliDetection()
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('close')"
      @keydown="handleKeydown"
    >
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-edge-subtle shrink-0">
          <h2 class="text-lg font-semibold text-content-primary">{{ t('settings.title') }}</h2>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
            :title="t('settings.fermer')"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          <!-- Language -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.language') }}</p>
            <select
              :value="settingsStore.language"
              @change="settingsStore.setLanguage(($event.target as HTMLSelectElement).value as import('@renderer/stores/settings').Language)"
              class="w-full bg-surface-secondary text-content-primary border border-edge-subtle rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
            >
              <option v-for="locale in availableLocales" :key="locale.code" :value="locale.code">
                {{ locale.label }}
              </option>
            </select>
          </div>

          <!-- Theme -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.theme') }}</p>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'dark'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setTheme('dark')"
              >{{ t('settings.dark') }}</button>
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'light'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setTheme('light')"
              >{{ t('settings.light') }}</button>
            </div>
          </div>

          <!-- Auto-launch agent sessions (T340) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoLaunch') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.autoLaunchDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.autoLaunchAgentSessions"
                @update:model-value="settingsStore.setAutoLaunchAgentSessions($event)"
              />
            </div>
          </div>

          <!-- Auto-review threshold (T341) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4 mb-2">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoReview') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.autoReviewDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.autoReviewEnabled"
                @update:model-value="settingsStore.setAutoReviewEnabled($event)"
              />
            </div>
            <div v-if="settingsStore.autoReviewEnabled" class="flex items-center gap-2 mt-2">
              <label class="text-xs text-content-muted">{{ t('settings.autoReviewThreshold') }}</label>
              <input
                type="number"
                :value="settingsStore.autoReviewThreshold"
                min="3"
                max="100"
                class="w-16 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-sm text-content-primary text-center outline-none focus:ring-1 focus:ring-violet-500"
                @change="settingsStore.setAutoReviewThreshold(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>

          <!-- Max file lines instruction (T899) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4 mb-2">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.maxFileLinesEnabled') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.maxFileLinesEnabledDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.maxFileLinesEnabled"
                @update:model-value="settingsStore.setMaxFileLinesEnabled($event)"
              />
            </div>
            <div v-if="settingsStore.maxFileLinesEnabled" class="flex items-center gap-2 mt-2">
              <label class="text-xs text-content-muted">{{ t('settings.maxFileLinesCount') }}</label>
              <input
                type="number"
                :value="settingsStore.maxFileLinesCount"
                min="50"
                max="10000"
                class="w-20 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-sm text-content-primary text-center outline-none focus:ring-1 focus:ring-violet-500"
                @change="settingsStore.setMaxFileLinesCount(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>

          <!-- Desktop notifications (T755) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.notifications') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.notificationsDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.notificationsEnabled"
                @update:model-value="settingsStore.setNotificationsEnabled($event)"
              />
            </div>
          </div>

          <!-- AI Coding Assistants (T1013) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.aiCodingAssistants') }}</p>
            <p class="text-xs text-content-faint mb-3">{{ t('settings.aiCodingAssistantsDesc') }}</p>
            <CliDetectionList
              :instances="settingsStore.allCliInstances"
              :enabled="settingsStore.enabledClis"
              :loading="settingsStore.detectingClis"
              @refresh="settingsStore.refreshCliDetection()"
              @toggle="settingsStore.toggleCli($event)"
            />
          </div>

          <!-- Default Claude instance (T857) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.defaultCliInstance') }}</p>
            <div v-if="claudeInstances.length === 0" class="text-sm text-content-subtle">—</div>
            <div v-else class="flex flex-col gap-2">
              <select
                class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-primary outline-none focus:ring-1 focus:ring-violet-500"
                :value="settingsStore.defaultCliInstance || claudeInstances[0]?.distro"
                @change="settingsStore.setDefaultCliInstance(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="inst in claudeInstances" :key="inst.distro" :value="inst.distro">
                  {{ instanceLabel(inst) }}
                </option>
              </select>
              <div v-if="(claudeInstances.find(i => i.distro === (settingsStore.defaultCliInstance || claudeInstances[0]?.distro))?.profiles?.length ?? 0) > 1">
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.defaultClaudeProfile') }}</p>
                <select
                  class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-primary outline-none focus:ring-1 focus:ring-violet-500"
                  :value="settingsStore.defaultClaudeProfile"
                  @change="settingsStore.setDefaultClaudeProfile(($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="profile in claudeInstances.find(i => i.distro === (settingsStore.defaultCliInstance || claudeInstances[0]?.distro))?.profiles"
                    :key="profile"
                    :value="profile"
                  >
                    {{ profile }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- Check for Updates (auto-updater T862/T864) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.updates') }}</p>
            <div class="flex items-center justify-between">
              <span class="text-sm text-content-muted">
                {{ t('settings.version') }}: <span class="font-mono text-content-tertiary">{{ settingsStore.appInfo.version }}</span>
              </span>
              <button
                class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="updaterStatus === 'checking' || updaterStatus === 'downloading'"
                @click="checkUpdaterNow"
              >
                {{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}
              </button>
            </div>
            <div v-if="updaterStatus !== 'idle' && updaterStatus !== 'checking'" class="mt-2">
              <span
                :class="[
                  'text-sm font-medium',
                  updaterStatus === 'available' || updaterStatus === 'downloaded' ? 'text-amber-400' :
                  updaterStatus === 'up-to-date' ? 'text-emerald-400' :
                  updaterStatus === 'error' ? 'text-red-400' : 'text-content-muted'
                ]"
              >
                <template v-if="updaterStatus === 'up-to-date'">{{ t('settings.upToDate') }}</template>
                <template v-else-if="updaterStatus === 'available'">{{ t('settings.updateAvailable') }}</template>
                <template v-else-if="updaterStatus === 'downloading'">{{ t('settings.downloading') }}</template>
                <template v-else-if="updaterStatus === 'downloaded'">{{ t('settings.downloaded') }}</template>
                <template v-else-if="updaterStatus === 'error'">{{ t('settings.updateError') }}</template>
              </span>
            </div>
          </div>

          <!-- About -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.about') }}</p>
            <p class="text-sm text-content-tertiary">
              {{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}
            </p>
            <p class="text-xs text-content-subtle mt-1">
              {{ t('settings.aboutDesc') }}
            </p>
          </div>

          <!-- Export ZIP -->
          <div v-if="store.dbPath" class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.exportData') }}</p>
            <button
              class="flex items-center gap-2 px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
              :disabled="exporting"
              @click="showExportConfirm = true"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              {{ exporting ? t('settings.exporting') : t('settings.exportBtn') }}
            </button>
          </div>

          <!-- DB Info -->
          <div v-if="store.dbPath" class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.database') }}</p>
            <p class="text-sm text-content-muted font-mono break-all">{{ store.dbPath }}</p>
          </div>

        </div>
      </div>
    </div>

    <!-- Export confirmation dialog -->
    <div
      v-if="showExportConfirm"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/60"
      @click.self="showExportConfirm = false"
    >
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-[360px] p-5">
        <h3 class="text-base font-semibold text-content-primary mb-2">{{ t('settings.exportConfirmTitle') }}</h3>
        <p class="text-sm text-content-muted mb-2">{{ t('settings.exportConfirmMsg') }}</p>
        <p class="text-xs text-amber-400 mb-4">{{ t('settings.exportConfirmWarn') }}</p>
        <div class="flex gap-2 justify-end">
          <button
            class="px-3 py-1.5 text-sm bg-surface-secondary hover:bg-surface-tertiary text-content-primary rounded-md transition-colors"
            @click="showExportConfirm = false"
          >
            {{ t('settings.exportCancel') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors"
            @click="exportZip"
          >
            {{ t('settings.exportConfirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
