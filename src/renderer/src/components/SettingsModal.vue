<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import ToggleSwitch from '@renderer/components/ToggleSwitch.vue'
import CliDetectionList from '@renderer/components/CliDetectionList.vue'
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

// Deduplicate by cli:distro so each CLI×environment pair gets its own entry (T1090)
const availableDistros = computed(() => {
  const seen = new Set<string>()
  return settingsStore.allCliInstances
    .filter(inst => {
      const key = `${inst.cli}:${inst.distro}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(inst => ({ cli: inst.cli, distro: inst.distro, type: inst.type }))
})

onMounted(async () => {
  await settingsStore.refreshCliDetection()
  if (store.dbPath) {
    await settingsStore.loadOpencodeDefaultModel(store.dbPath)
  }
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <v-dialog model-value max-width="700" :height="600" scrollable @update:model-value="emit('close')">
    <v-card class="d-flex flex-column" style="max-height: 85vh;" @keydown="handleKeydown">

        <!-- Header -->
        <div class="modal-header">
          <h2 class="text-subtitle-1 font-weight-medium" style="color: var(--content-primary)">{{ t('settings.title') }}</h2>
          <button
            class="btn-close"
            :title="t('settings.fermer')"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" style="width: 16px; height: 16px;">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Body: sidebar + content panel -->
        <div class="d-flex flex-grow-1" style="min-height: 0;">

          <!-- Sidebar navigation -->
          <nav class="settings-nav">
            <button
              v-for="s in sections"
              :key="s.id"
              :data-testid="`nav-${s.id}`"
              class="nav-btn"
              :class="activeSection === s.id ? 'nav-btn--active' : ''"
              @click="activeSection = s.id"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="nav-icon" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path :d="SECTION_ICONS[s.id]" />
              </svg>
              {{ t(s.labelKey) }}
            </button>
          </nav>

          <!-- Content panel -->
          <div class="settings-content">

            <!-- Appearance: Language + Theme -->
            <template v-if="activeSection === 'appearance'">
              <div class="settings-card">
                <p class="settings-label">{{ t('settings.language') }}</p>
                <select
                  :value="settingsStore.language"
                  class="form-select"
                  @change="settingsStore.setLanguage(($event.target as HTMLSelectElement).value as import('@renderer/stores/settings').Language)"
                >
                  <option v-for="locale in availableLocales" :key="locale.code" :value="locale.code">{{ locale.label }}</option>
                </select>
              </div>
              <div class="settings-card">
                <p class="settings-label">{{ t('settings.theme') }}</p>
                <div class="d-flex ga-2">
                  <button
                    :class="['theme-btn', settingsStore.theme === 'dark' ? 'theme-btn--active' : '']"
                    @click="settingsStore.setTheme('dark')"
                  >{{ t('settings.dark') }}</button>
                  <button
                    :class="['theme-btn', settingsStore.theme === 'light' ? 'theme-btn--active' : '']"
                    @click="settingsStore.setTheme('light')"
                  >{{ t('settings.light') }}</button>
                </div>
              </div>
            </template>

            <!-- Automation: Auto-launch + Auto-review -->
            <template v-else-if="activeSection === 'automation'">
              <div class="settings-card">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label">{{ t('settings.autoLaunch') }}</p>
                    <p class="settings-desc">{{ t('settings.autoLaunchDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.autoLaunchAgentSessions" @update:model-value="settingsStore.setAutoLaunchAgentSessions($event)" />
                </div>
              </div>
              <div class="settings-card">
                <div class="d-flex align-center justify-space-between ga-4 mb-2">
                  <div>
                    <p class="settings-label">{{ t('settings.autoReview') }}</p>
                    <p class="settings-desc">{{ t('settings.autoReviewDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.autoReviewEnabled" @update:model-value="settingsStore.setAutoReviewEnabled($event)" />
                </div>
                <div v-if="settingsStore.autoReviewEnabled" class="d-flex align-center ga-2 mt-2">
                  <label class="settings-desc">{{ t('settings.autoReviewThreshold') }}</label>
                  <input type="number" :value="settingsStore.autoReviewThreshold" min="3" max="100"
                    class="form-input-small"
                    @change="settingsStore.setAutoReviewThreshold(Number(($event.target as HTMLInputElement).value))" />
                </div>
              </div>
              <div class="settings-card">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label">{{ t('settings.worktreeDefault') }}</p>
                    <p class="settings-desc">{{ t('settings.worktreeDefaultDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.worktreeDefault" @update:model-value="store.dbPath && settingsStore.setWorktreeDefault(store.dbPath, $event)" />
                </div>
              </div>
            </template>

            <!-- Editor: Max file lines -->
            <template v-else-if="activeSection === 'editor'">
              <div class="settings-card">
                <div class="d-flex align-center justify-space-between ga-4 mb-2">
                  <div>
                    <p class="settings-label">{{ t('settings.maxFileLinesEnabled') }}</p>
                    <p class="settings-desc">{{ t('settings.maxFileLinesEnabledDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.maxFileLinesEnabled" @update:model-value="settingsStore.setMaxFileLinesEnabled($event)" />
                </div>
                <div v-if="settingsStore.maxFileLinesEnabled" class="d-flex align-center ga-2 mt-2">
                  <label class="settings-desc">{{ t('settings.maxFileLinesCount') }}</label>
                  <input type="number" :value="settingsStore.maxFileLinesCount" min="50" max="10000"
                    class="form-input-small form-input-small--wide"
                    @change="settingsStore.setMaxFileLinesCount(Number(($event.target as HTMLInputElement).value))" />
                </div>
              </div>
            </template>

            <!-- CLI & Agents -->
            <template v-else-if="activeSection === 'cli'">
              <div class="settings-card">
                <p class="settings-label">{{ t('settings.aiCodingAssistants') }}</p>
                <p class="settings-desc mb-3">{{ t('settings.aiCodingAssistantsDesc') }}</p>
                <CliDetectionList
                  :instances="settingsStore.allCliInstances"
                  :enabled="settingsStore.enabledClis"
                  :loading="settingsStore.detectingClis"
                  @refresh="settingsStore.refreshCliDetection()"
                  @toggle="settingsStore.toggleCli($event)"
                />
              </div>
              <div class="settings-card">
                <p class="settings-label">{{ t('settings.defaultCliInstance') }}</p>
                <div v-if="availableDistros.length === 0" class="settings-desc">—</div>
                <div v-else>
                  <select
                    class="form-select"
                    :value="settingsStore.defaultCliInstance || (availableDistros[0] ? `${availableDistros[0].cli}:${availableDistros[0].distro}` : '')"
                    @change="(e) => { const v = (e.target as HTMLSelectElement).value; const sep = v.indexOf(':'); settingsStore.setDefaultCliInstance(sep === -1 ? '' : v.slice(0, sep), sep === -1 ? v : v.slice(sep + 1)) }"
                  >
                    <option v-for="inst in availableDistros" :key="`${inst.cli}:${inst.distro}`" :value="`${inst.cli}:${inst.distro}`">{{ inst.cli }} — {{ inst.distro === 'local' ? 'Local' : inst.distro + ' (WSL)' }}</option>
                  </select>
                </div>
              </div>
              <div class="settings-card">
                <p class="settings-label">{{ t('settings.opencodeDefaultModel') }}</p>
                <p class="settings-desc mb-2">{{ t('settings.opencodeDefaultModelHint') }}</p>
                <input
                  type="text"
                  :value="settingsStore.opencodeDefaultModel"
                  placeholder="anthropic/claude-opus-4-5"
                  class="form-input"
                  @blur="store.dbPath && settingsStore.setOpencodeDefaultModel(store.dbPath, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </template>

            <!-- Notifications -->
            <template v-else-if="activeSection === 'notifications'">
              <div class="settings-card">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label">{{ t('settings.notifications') }}</p>
                    <p class="settings-desc">{{ t('settings.notificationsDesc') }}</p>
                  </div>
                  <ToggleSwitch :model-value="settingsStore.notificationsEnabled" @update:model-value="settingsStore.setNotificationsEnabled($event)" />
                </div>
              </div>
            </template>

            <!-- Application: Updates + About + Export + DB -->
            <template v-else-if="activeSection === 'application'">
              <div class="settings-card">
                <p class="settings-label mb-3">{{ t('settings.updates') }}</p>
                <div class="d-flex align-center justify-space-between">
                  <span class="settings-desc">
                    {{ t('settings.version') }}: <span class="font-mono">{{ settingsStore.appInfo.version }}</span>
                  </span>
                  <button
                    class="btn-primary"
                    :disabled="updaterStatus === 'checking' || updaterStatus === 'downloading'"
                    @click="checkUpdaterNow"
                  >{{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}</button>
                </div>
                <div v-if="updaterStatus !== 'idle' && updaterStatus !== 'checking'" class="mt-2">
                  <span :class="['text-body-2 font-weight-medium', updaterStatus === 'available' || updaterStatus === 'downloaded' ? 'text-amber' : updaterStatus === 'up-to-date' ? 'text-emerald' : updaterStatus === 'error' ? 'text-red' : '']">
                    <template v-if="updaterStatus === 'up-to-date'">{{ t('settings.upToDate') }}</template>
                    <template v-else-if="updaterStatus === 'available'">{{ t('settings.updateAvailable') }}</template>
                    <template v-else-if="updaterStatus === 'downloading'">{{ t('settings.downloading') }}</template>
                    <template v-else-if="updaterStatus === 'downloaded'">{{ t('settings.downloaded') }}</template>
                    <template v-else-if="updaterStatus === 'error'">{{ t('settings.updateError') }}</template>
                  </span>
                </div>
              </div>
              <div class="settings-card">
                <p class="settings-label mb-2">{{ t('settings.about') }}</p>
                <p class="settings-desc">{{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}</p>
                <p class="settings-desc mt-1">{{ t('settings.aboutDesc') }}</p>
              </div>
              <div v-if="store.dbPath" class="settings-card">
                <p class="settings-label mb-3">{{ t('settings.exportData') }}</p>
                <button
                  class="btn-primary btn-icon"
                  :disabled="exporting"
                  @click="showExportConfirm = true"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" style="width: 16px; height: 16px;">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                  </svg>
                  {{ exporting ? t('settings.exporting') : t('settings.exportBtn') }}
                </button>
              </div>
              <div v-if="store.dbPath" class="settings-card">
                <p class="settings-label mb-2">{{ t('settings.database') }}</p>
                <p class="settings-desc font-mono" style="word-break: break-all;">{{ store.dbPath }}</p>
              </div>
            </template>

          </div>
        </div>
    </v-card>
  </v-dialog>

  <!-- Export confirmation nested dialog -->
  <v-dialog v-model="showExportConfirm" max-width="360">
    <v-card class="pa-5">
      <h3 class="text-body-1 font-weight-medium mb-2" style="color: var(--content-primary)">{{ t('settings.exportConfirmTitle') }}</h3>
      <p class="text-body-2 mb-2" style="color: var(--content-muted)">{{ t('settings.exportConfirmMsg') }}</p>
      <p class="text-caption mb-4" style="color: #f59e0b;">{{ t('settings.exportConfirmWarn') }}</p>
      <div class="d-flex ga-2 justify-end">
        <button
          class="btn-ghost"
          @click="showExportConfirm = false"
        >{{ t('settings.exportCancel') }}</button>
        <button
          class="btn-primary"
          @click="exportZip"
        >{{ t('settings.exportConfirm') }}</button>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Modal layout */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}

/* Close button */
.btn-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: none;
  color: var(--content-subtle);
  cursor: pointer;
  transition: all 150ms;
}
.btn-close:hover {
  color: var(--content-secondary);
  background: var(--surface-secondary);
}

/* Sidebar nav */
.settings-nav {
  width: 176px;
  flex-shrink: 0;
  border-right: 1px solid var(--edge-subtle);
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: none;
  background: none;
  font-size: 14px;
  color: var(--content-muted);
  cursor: pointer;
  transition: all 150ms;
  text-align: left;
  margin: 0 4px;
  box-sizing: border-box;
}
.nav-btn:hover {
  background: var(--surface-secondary);
  color: var(--content-secondary);
}
.nav-btn--active {
  background: rgba(124, 58, 237, 0.2);
  color: #c4b5fd;
  font-weight: 500;
}
.nav-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Content panel */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Settings card */
.settings-card {
  background: var(--surface-base);
  border: 1px solid var(--edge-subtle);
  border-radius: 8px;
  padding: 12px 16px;
}
.settings-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.settings-desc {
  font-size: 12px;
  color: var(--content-faint);
}

/* Form elements */
.form-select {
  width: 100%;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: 1px solid var(--edge-subtle);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  cursor: pointer;
  box-sizing: border-box;
}
.form-select:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}
.form-input {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--content-primary);
  outline: none;
  transition: border-color 150ms;
  box-sizing: border-box;
}
.form-input:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}
.form-input-small {
  width: 64px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  color: var(--content-primary);
  text-align: center;
  outline: none;
  transition: border-color 150ms;
}
.form-input-small--wide {
  width: 80px;
}
.form-input-small:focus {
  border-color: #8b5cf6;
  box-shadow: 0 0 0 1px #8b5cf6;
}

/* Theme buttons */
.theme-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  background: var(--surface-secondary);
  color: var(--content-muted);
  cursor: pointer;
  transition: all 150ms;
}
.theme-btn:hover {
  background: var(--surface-tertiary);
}
.theme-btn--active {
  background: #7c3aed;
  color: white;
}

/* Buttons */
.btn-primary {
  padding: 6px 12px;
  font-size: 14px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms;
}
.btn-primary:hover:not(:disabled) {
  background: #6d28d9;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-icon {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn-ghost {
  padding: 6px 12px;
  font-size: 14px;
  background: var(--surface-secondary);
  color: var(--content-primary);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms;
}
.btn-ghost:hover {
  background: var(--surface-tertiary);
}

/* Typography utilities */
.font-mono {
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-tertiary);
}

/* Updater status colors */
.text-amber { color: #fbbf24; }
.text-emerald { color: #34d399; }
.text-red { color: #f87171; }
</style>
