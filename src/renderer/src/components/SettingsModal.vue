<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, type Language, type Theme } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
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
  appearance: 'mdi-white-balance-sunny',
  automation: 'mdi-lightning-bolt',
  editor: 'mdi-file-document-outline',
  cli: 'mdi-console',
  notifications: 'mdi-bell-outline',
  application: 'mdi-information-outline',
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

const availableDistroItems = computed(() =>
  availableDistros.value.map(inst => ({
    title: `${inst.cli} — ${inst.distro === 'local' ? 'Local' : inst.distro + ' (WSL)'}`,
    value: `${inst.cli}:${inst.distro}`,
  }))
)

onMounted(async () => {
  await settingsStore.refreshCliDetection()
  if (store.dbPath) {
    await settingsStore.loadOpencodeDefaultModel(store.dbPath)
  }
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onDefaultCliChange(v: string) {
  const sep = v.indexOf(':')
  settingsStore.setDefaultCliInstance(sep === -1 ? '' : v.slice(0, sep), sep === -1 ? v : v.slice(sep + 1))
}
</script>

<template>
  <!-- scrollable removed: content panel handles its own scroll independently (Discord-style) -->
  <v-dialog model-value max-width="700" :height="700" @update:model-value="emit('close')">
    <v-card class="d-flex flex-column" style="max-height: 85vh;" @keydown="handleKeydown">

        <!-- Header -->
        <div class="modal-header">
          <h2 class="text-subtitle-1 font-weight-medium" style="color: var(--content-primary)">{{ t('settings.title') }}</h2>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :title="t('settings.fermer')"
            data-testid="close-btn"
            @click="emit('close')"
          />
        </div>

        <!-- Body: sidebar + content panel -->
        <div class="d-flex flex-grow-1" style="min-height: 0;">

          <!-- Sidebar navigation -->
          <v-list
            nav
            density="compact"
            bg-color="transparent"
            class="pa-1"
            style="width: 176px; flex-shrink: 0; border-right: 1px solid var(--edge-subtle);"
          >
            <v-list-item
              v-for="s in sections"
              :key="s.id"
              :prepend-icon="SECTION_ICONS[s.id]"
              :title="t(s.labelKey)"
              :active="activeSection === s.id"
              :data-testid="`nav-${s.id}`"
              color="primary"
              @click="activeSection = s.id"
            />
          </v-list>

          <!-- Content panel: scrolls independently, sidebar stays fixed -->
          <div class="settings-content">

            <!-- Appearance: Language + Theme -->
            <template v-if="activeSection === 'appearance'">
              <div class="settings-section">
                <p class="settings-label text-label-medium">{{ t('settings.language') }}</p>
                <v-select
                  :model-value="settingsStore.language"
                  :items="availableLocales"
                  item-title="label"
                  item-value="code"
                  density="compact"
                  hide-details
                  data-testid="lang-select"
                  @update:model-value="(v) => settingsStore.setLanguage(v as Language)"
                />
              </div>
              <div class="settings-section">
                <p class="settings-label text-label-medium">{{ t('settings.theme') }}</p>
                <v-btn-toggle
                  :model-value="settingsStore.theme"
                  mandatory
                  color="primary"
                  variant="outlined"
                  density="compact"
                  data-testid="theme-toggle"
                  @update:model-value="(v) => settingsStore.setTheme(v as Theme)"
                >
                  <v-btn value="dark">{{ t('settings.dark') }}</v-btn>
                  <v-btn value="light">{{ t('settings.light') }}</v-btn>
                </v-btn-toggle>
              </div>
            </template>

            <!-- Automation: Auto-launch + Auto-review -->
            <template v-else-if="activeSection === 'automation'">
              <div class="settings-section">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label text-label-medium">{{ t('settings.autoLaunch') }}</p>
                    <p class="settings-desc text-caption">{{ t('settings.autoLaunchDesc') }}</p>
                  </div>
                  <v-switch hide-details density="compact" color="primary" :model-value="settingsStore.autoLaunchAgentSessions" @update:model-value="settingsStore.setAutoLaunchAgentSessions(Boolean($event))" />
                </div>
              </div>
              <div class="settings-section">
                <div class="d-flex align-center justify-space-between ga-4 mb-2">
                  <div>
                    <p class="settings-label text-label-medium">{{ t('settings.autoReview') }}</p>
                    <p class="settings-desc text-caption">{{ t('settings.autoReviewDesc') }}</p>
                  </div>
                  <v-switch hide-details density="compact" color="primary" :model-value="settingsStore.autoReviewEnabled" @update:model-value="settingsStore.setAutoReviewEnabled(Boolean($event))" />
                </div>
                <div v-if="settingsStore.autoReviewEnabled" class="d-flex align-center ga-2 mt-2">
                  <label class="settings-desc text-caption">{{ t('settings.autoReviewThreshold') }}</label>
                  <v-text-field
                    type="number"
                    :model-value="settingsStore.autoReviewThreshold"
                    :min="3"
                    :max="100"
                    density="compact"
                    hide-details
                    style="width: 80px"
                    @update:model-value="(v) => settingsStore.setAutoReviewThreshold(Number(v))"
                  />
                </div>
              </div>
              <div class="settings-section">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label text-label-medium">{{ t('settings.worktreeDefault') }}</p>
                    <p class="settings-desc text-caption">{{ t('settings.worktreeDefaultDesc') }}</p>
                  </div>
                  <v-switch hide-details density="compact" color="primary" :model-value="settingsStore.worktreeDefault" @update:model-value="store.dbPath && settingsStore.setWorktreeDefault(store.dbPath, Boolean($event))" />
                </div>
              </div>
            </template>

            <!-- Editor: Max file lines -->
            <template v-else-if="activeSection === 'editor'">
              <div class="settings-section">
                <div class="d-flex align-center justify-space-between ga-4 mb-2">
                  <div>
                    <p class="settings-label text-label-medium">{{ t('settings.maxFileLinesEnabled') }}</p>
                    <p class="settings-desc text-caption">{{ t('settings.maxFileLinesEnabledDesc') }}</p>
                  </div>
                  <v-switch hide-details density="compact" color="primary" :model-value="settingsStore.maxFileLinesEnabled" @update:model-value="settingsStore.setMaxFileLinesEnabled(Boolean($event))" />
                </div>
                <div v-if="settingsStore.maxFileLinesEnabled" class="d-flex align-center ga-2 mt-2">
                  <label class="settings-desc text-caption">{{ t('settings.maxFileLinesCount') }}</label>
                  <v-text-field
                    type="number"
                    :model-value="settingsStore.maxFileLinesCount"
                    :min="50"
                    :max="10000"
                    density="compact"
                    hide-details
                    style="width: 96px"
                    data-testid="max-file-lines-count"
                    @update:model-value="(v) => settingsStore.setMaxFileLinesCount(Number(v))"
                  />
                </div>
              </div>
            </template>

            <!-- CLI & Agents -->
            <template v-else-if="activeSection === 'cli'">
              <div class="settings-section">
                <p class="settings-label text-label-medium">{{ t('settings.aiCodingAssistants') }}</p>
                <p class="settings-desc mb-3 text-caption">{{ t('settings.aiCodingAssistantsDesc') }}</p>
                <CliDetectionList
                  :instances="settingsStore.allCliInstances"
                  :enabled="settingsStore.enabledClis"
                  :loading="settingsStore.detectingClis"
                  @refresh="settingsStore.refreshCliDetection()"
                  @toggle="settingsStore.toggleCli($event)"
                />
              </div>
              <div class="settings-section">
                <p class="settings-label text-label-medium">{{ t('settings.defaultCliInstance') }}</p>
                <div v-if="availableDistros.length === 0" class="settings-desc text-caption">—</div>
                <v-select
                  v-else
                  :model-value="settingsStore.defaultCliInstance || (availableDistros[0] ? `${availableDistros[0].cli}:${availableDistros[0].distro}` : '')"
                  :items="availableDistroItems"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => onDefaultCliChange(v as string)"
                />
              </div>
              <div class="settings-section">
                <p class="settings-label text-label-medium">{{ t('settings.opencodeDefaultModel') }}</p>
                <p class="settings-desc mb-2 text-caption">{{ t('settings.opencodeDefaultModelHint') }}</p>
                <v-text-field
                  :model-value="settingsStore.opencodeDefaultModel"
                  placeholder="anthropic/claude-opus-4-5"
                  density="compact"
                  hide-details
                  @blur="(e: FocusEvent) => store.dbPath && settingsStore.setOpencodeDefaultModel(store.dbPath, (e.target as HTMLInputElement).value)"
                />
              </div>
            </template>

            <!-- Notifications -->
            <template v-else-if="activeSection === 'notifications'">
              <div class="settings-section">
                <div class="d-flex align-center justify-space-between ga-4">
                  <div>
                    <p class="settings-label text-label-medium">{{ t('settings.notifications') }}</p>
                    <p class="settings-desc text-caption">{{ t('settings.notificationsDesc') }}</p>
                  </div>
                  <v-switch hide-details density="compact" color="primary" :model-value="settingsStore.notificationsEnabled" @update:model-value="settingsStore.setNotificationsEnabled(Boolean($event))" />
                </div>
              </div>
            </template>

            <!-- Application: Updates + About + Export + DB -->
            <template v-else-if="activeSection === 'application'">
              <div class="settings-section">
                <p class="settings-label mb-3 text-label-medium">{{ t('settings.updates') }}</p>
                <div class="d-flex align-center justify-space-between">
                  <span class="settings-desc text-caption">
                    {{ t('settings.version') }}: <span class="font-mono">{{ settingsStore.appInfo.version }}</span>
                  </span>
                  <v-btn
                    color="primary"
                    :disabled="updaterStatus === 'checking' || updaterStatus === 'downloading'"
                    @click="checkUpdaterNow"
                  >{{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}</v-btn>
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
              <div class="settings-section">
                <p class="settings-label mb-2 text-label-medium">{{ t('settings.about') }}</p>
                <p class="settings-desc text-caption">{{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}</p>
                <p class="settings-desc mt-1 text-caption">{{ t('settings.aboutDesc') }}</p>
              </div>
              <div v-if="store.dbPath" class="settings-section">
                <p class="settings-label mb-3 text-label-medium">{{ t('settings.exportData') }}</p>
                <v-btn
                  color="primary"
                  prepend-icon="mdi-download"
                  :disabled="exporting"
                  @click="showExportConfirm = true"
                >{{ exporting ? t('settings.exporting') : t('settings.exportBtn') }}</v-btn>
              </div>
              <div v-if="store.dbPath" class="settings-section">
                <p class="settings-label mb-2 text-label-medium">{{ t('settings.database') }}</p>
                <p class="settings-desc font-mono text-caption" style="word-break: break-all;">{{ store.dbPath }}</p>
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
      <p class="text-caption mb-4" style="color: rgb(var(--v-theme-warning));">{{ t('settings.exportConfirmWarn') }}</p>
      <div class="d-flex ga-2 justify-end">
        <v-btn variant="text" @click="showExportConfirm = false">{{ t('settings.exportCancel') }}</v-btn>
        <v-btn color="primary" @click="exportZip">{{ t('settings.exportConfirm') }}</v-btn>
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

/* Content panel: scrolls independently — sidebar stays fixed (Discord-style) */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Section containers: subtle MD3-style divider — 8% white opacity, not the harsh Vuetify outlined border */
.settings-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px 16px;
}

/* Settings labels and descriptions
   surface-dialog = zinc-800 (#27272a) — content-subtle/faint fail WCAG AA on this bg.
   content-tertiary (zinc-300) → ~8.8:1 on zinc-800 ✓  content-muted (zinc-400) → ~5.1:1 ✓ */
.settings-label {
  font-weight: 500;
  color: var(--content-tertiary);
  letter-spacing: 0.02em;
  margin-bottom: 8px;
}
.settings-desc {
  color: var(--content-muted);
}

/* Typography utilities */
.font-mono {
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-tertiary);
}

/* Updater status colors */
.text-amber { color: rgb(var(--v-theme-warning)); }
.text-emerald { color: rgb(var(--v-theme-secondary)); }
.text-red { color: rgb(var(--v-theme-error)); }
</style>
