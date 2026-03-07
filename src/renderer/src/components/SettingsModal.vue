<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import ToggleSwitch from '@renderer/components/ToggleSwitch.vue'
import CliDetectionList from '@renderer/components/CliDetectionList.vue'
import type { CliInstance } from '@shared/cli-types'
import { useUpdater } from '@renderer/composables/useUpdater'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

type Section = 'appearance' | 'automation' | 'editor' | 'cli' | 'notifications' | 'application'
const activeSection = ref<Section>('appearance')

const sections: Array<{ id: Section; labelKey: string }> = [
  { id: 'appearance', labelKey: 'settings.sections.appearance' },
  { id: 'automation', labelKey: 'settings.sections.automation' },
  { id: 'editor', labelKey: 'settings.sections.editor' },
  { id: 'cli', labelKey: 'settings.sections.cli' },
  { id: 'notifications', labelKey: 'settings.sections.notifications' },
  { id: 'application', labelKey: 'settings.sections.application' },
]

const SECTION_ICONS: Record<Section, string> = {
  appearance: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364-.707.707M6.343 17.657l-.707.707m12.728 0-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  automation: 'M13 10V3L4 14h7v7l9-11h-7z',
  editor: 'M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  cli: 'm8 9 3 3-3 3m5 0h3M5 20h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z',
  notifications: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6 6 0 0 0-9.33-5.002C8.28 6.32 8 6.965 8 7.636V11c0 .856-.315 1.637-.844 2.243L6 14.636V17h9zm0 0v1a3 3 0 0 1-6 0v-1h6z',
  application: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
}

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

const availableDistros = ref<{ distro: string; type: 'local' | 'wsl' }[]>([])

onMounted(async () => {
  const rawInstances = await window.electronAPI.getCliInstances() as CliInstance[]
  const seen = new Set<string>()
  availableDistros.value = (Array.isArray(rawInstances) ? rawInstances : [])
    .filter(inst => { if (seen.has(inst.distro)) return false; seen.add(inst.distro); return true })
    .map(inst => ({ distro: inst.distro, type: inst.type }))
  await settingsStore.refreshCliDetection()
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('close')"
      @keydown="handleKeydown"
    >
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col">

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

        <!-- Body: sidebar + content panel -->
        <div class="flex flex-1 min-h-0">

          <!-- Sidebar navigation -->
          <nav class="w-44 shrink-0 border-r border-edge-subtle py-2 flex flex-col gap-0.5 overflow-y-auto">
            <button
              v-for="s in sections"
              :key="s.id"
              :data-testid="`nav-${s.id}`"
              @click="activeSection = s.id"
              :class="[
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left mx-1',
                activeSection === s.id
                  ? 'bg-violet-600/20 text-violet-300 font-medium'
                  : 'text-content-muted hover:bg-surface-secondary hover:text-content-secondary'
              ]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4 shrink-0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="SECTION_ICONS[s.id]" />
              </svg>
              {{ t(s.labelKey) }}
            </button>
          </nav>

          <!-- Content panel -->
          <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

            <!-- Appearance: Language + Theme -->
            <template v-if="activeSection === 'appearance'">
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.language') }}</p>
                <select
                  :value="settingsStore.language"
                  @change="settingsStore.setLanguage(($event.target as HTMLSelectElement).value as import('@renderer/stores/settings').Language)"
                  class="w-full bg-surface-secondary text-content-primary border border-edge-subtle rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                >
                  <option v-for="locale in availableLocales" :key="locale.code" :value="locale.code">{{ locale.label }}</option>
                </select>
              </div>
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.theme') }}</p>
                <div class="flex gap-2">
                  <button
                    :class="['flex-1 py-2 px-3 rounded text-sm font-medium transition-colors', settingsStore.theme === 'dark' ? 'bg-violet-600 text-white' : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary']"
                    @click="settingsStore.setTheme('dark')"
                  >{{ t('settings.dark') }}</button>
                  <button
                    :class="['flex-1 py-2 px-3 rounded text-sm font-medium transition-colors', settingsStore.theme === 'light' ? 'bg-violet-600 text-white' : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary']"
                    @click="settingsStore.setTheme('light')"
                  >{{ t('settings.light') }}</button>
                </div>
              </div>
            </template>

            <!-- Automation: Auto-launch + Auto-review -->
            <template v-else-if="activeSection === 'automation'">
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoLaunch') }}</p>
                    <p class="text-xs text-content-faint">{{ t('settings.autoLaunchDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.autoLaunchAgentSessions" @update:model-value="settingsStore.setAutoLaunchAgentSessions($event)" />
                </div>
              </div>
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <div class="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoReview') }}</p>
                    <p class="text-xs text-content-faint">{{ t('settings.autoReviewDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.autoReviewEnabled" @update:model-value="settingsStore.setAutoReviewEnabled($event)" />
                </div>
                <div v-if="settingsStore.autoReviewEnabled" class="flex items-center gap-2 mt-2">
                  <label class="text-xs text-content-muted">{{ t('settings.autoReviewThreshold') }}</label>
                  <input type="number" :value="settingsStore.autoReviewThreshold" min="3" max="100"
                    class="w-16 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-sm text-content-primary text-center outline-none focus:ring-1 focus:ring-violet-500"
                    @change="settingsStore.setAutoReviewThreshold(Number(($event.target as HTMLInputElement).value))" />
                </div>
              </div>
            </template>

            <!-- Editor: Max file lines -->
            <template v-else-if="activeSection === 'editor'">
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <div class="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.maxFileLinesEnabled') }}</p>
                    <p class="text-xs text-content-faint">{{ t('settings.maxFileLinesEnabledDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.maxFileLinesEnabled" @update:model-value="settingsStore.setMaxFileLinesEnabled($event)" />
                </div>
                <div v-if="settingsStore.maxFileLinesEnabled" class="flex items-center gap-2 mt-2">
                  <label class="text-xs text-content-muted">{{ t('settings.maxFileLinesCount') }}</label>
                  <input type="number" :value="settingsStore.maxFileLinesCount" min="50" max="10000"
                    class="w-20 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-sm text-content-primary text-center outline-none focus:ring-1 focus:ring-violet-500"
                    @change="settingsStore.setMaxFileLinesCount(Number(($event.target as HTMLInputElement).value))" />
                </div>
              </div>
            </template>

            <!-- CLI & Agents -->
            <template v-else-if="activeSection === 'cli'">
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
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.defaultCliInstance') }}</p>
                <div v-if="availableDistros.length === 0" class="text-sm text-content-subtle">—</div>
                <div v-else>
                  <select
                    class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-primary outline-none focus:ring-1 focus:ring-violet-500"
                    :value="settingsStore.defaultCliInstance || availableDistros[0]?.distro"
                    @change="settingsStore.setDefaultCliInstance(($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="inst in availableDistros" :key="inst.distro" :value="inst.distro">{{ inst.distro === 'local' ? 'Local' : inst.distro + ' (WSL)' }}</option>
                  </select>
                </div>
              </div>
            </template>

            <!-- Notifications -->
            <template v-else-if="activeSection === 'notifications'">
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.notifications') }}</p>
                    <p class="text-xs text-content-faint">{{ t('settings.notificationsDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.notificationsEnabled" @update:model-value="settingsStore.setNotificationsEnabled($event)" />
                </div>
              </div>
            </template>

            <!-- Application: Updates + About + Export + DB -->
            <template v-else-if="activeSection === 'application'">
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
                  >{{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}</button>
                </div>
                <div v-if="updaterStatus !== 'idle' && updaterStatus !== 'checking'" class="mt-2">
                  <span :class="['text-sm font-medium', updaterStatus === 'available' || updaterStatus === 'downloaded' ? 'text-amber-400' : updaterStatus === 'up-to-date' ? 'text-emerald-400' : updaterStatus === 'error' ? 'text-red-400' : 'text-content-muted']">
                    <template v-if="updaterStatus === 'up-to-date'">{{ t('settings.upToDate') }}</template>
                    <template v-else-if="updaterStatus === 'available'">{{ t('settings.updateAvailable') }}</template>
                    <template v-else-if="updaterStatus === 'downloading'">{{ t('settings.downloading') }}</template>
                    <template v-else-if="updaterStatus === 'downloaded'">{{ t('settings.downloaded') }}</template>
                    <template v-else-if="updaterStatus === 'error'">{{ t('settings.updateError') }}</template>
                  </span>
                </div>
              </div>
              <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.about') }}</p>
                <p class="text-sm text-content-tertiary">{{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}</p>
                <p class="text-xs text-content-subtle mt-1">{{ t('settings.aboutDesc') }}</p>
              </div>
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
              <div v-if="store.dbPath" class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
                <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.database') }}</p>
                <p class="text-sm text-content-muted font-mono break-all">{{ store.dbPath }}</p>
              </div>
            </template>

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
          >{{ t('settings.exportCancel') }}</button>
          <button
            class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors"
            @click="exportZip"
          >{{ t('settings.exportConfirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
