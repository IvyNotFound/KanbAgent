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
  <v-dialog model-value width="760" height="560" @update:model-value="emit('close')">
    <v-card class="d-flex flex-column" height="100%" @keydown="handleKeydown">
      <!-- ── Header ──
           Note: <template #append> on v-toolbar triggers Vue 3.5.31 codegen bug.
           Using v-spacer in default slot instead. -->
      <v-toolbar density="compact" flat class="flex-shrink-0">
        <v-toolbar-title class="text-subtitle-1 font-weight-medium">
          {{ t('settings.title') }}
        </v-toolbar-title>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          :title="t('settings.fermer')"
          data-testid="close-btn"
          @click="emit('close')"
        />
      </v-toolbar>
      <v-divider />

      <!-- ── Body ── -->
      <div class="d-flex flex-grow-1 overflow-hidden settings-body">
<!-- Nav rail -->
        <v-list
          nav
          density="compact"
          bg-color="transparent"
          :width="200"
          class="pa-2 flex-shrink-0 overflow-y-auto"
        >
          <v-list-item
            v-for="s in sections"
            :key="s.id"
            rounded="lg"
            color="primary"
            :prepend-icon="SECTION_ICONS[s.id]"
            :title="t(s.labelKey)"
            :active="activeSection === s.id"
            :data-testid="`nav-${s.id}`"
            @click="activeSection = s.id"
          />
        </v-list>

        <v-divider vertical />

        <!-- Content panel -->
        <div class="flex-grow-1 overflow-y-auto pa-4">
<!-- ── appearance ── -->
          <div v-show="activeSection === 'appearance'" class="d-flex flex-column ga-3">
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.language') }}</p>
              <v-select
                :model-value="settingsStore.language"
                :items="availableLocales"
                item-title="label"
                item-value="code"
                variant="outlined"
                density="compact"
                hide-details
                data-testid="lang-select"
                @update:model-value="(v) => settingsStore.setLanguage(v as Language)"
              />
            </v-sheet>
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.theme') }}</p>
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
            </v-sheet>
          </div>

          <!-- ── automation ──
               Note: <template #append> on v-list-item triggers Vue 3.5.31 codegen bug.
               Using v-sheet + d-flex layout for switches. -->
          <div v-show="activeSection === 'automation'" class="d-flex flex-column ga-3">
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
                  class="threshold-input"
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
          </div>

          <!-- ── editor ── -->
          <div v-show="activeSection === 'editor'" class="d-flex flex-column ga-3">
            <v-sheet rounded="lg" border class="pa-4">
              <div class="d-flex align-center justify-space-between ga-4">
                <div>
                  <p class="text-body-2 font-weight-medium">{{ t('settings.maxFileLinesEnabled') }}</p>
                  <p class="text-body-2 text-medium-emphasis">{{ t('settings.maxFileLinesEnabledDesc') }}</p>
                </div>
                <v-switch
                  hide-details
                  density="compact"
                  color="primary"
                  :model-value="settingsStore.maxFileLinesEnabled"
                  @update:model-value="settingsStore.setMaxFileLinesEnabled(Boolean($event))"
                />
              </div>
              <div v-if="settingsStore.maxFileLinesEnabled" class="d-flex align-center ga-2 mt-3">
                <label class="text-body-2 text-medium-emphasis">{{ t('settings.maxFileLinesCount') }}</label>
                <v-text-field
                  type="number"
                  :model-value="settingsStore.maxFileLinesCount"
                  :min="50"
                  :max="10000"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="count-input"
                  data-testid="max-file-lines-count"
                  @update:model-value="(v) => settingsStore.setMaxFileLinesCount(Number(v))"
                />
              </div>
            </v-sheet>
          </div>

          <!-- ── cli ── -->
          <div v-show="activeSection === 'cli'" class="d-flex flex-column ga-3">
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-1">{{ t('settings.aiCodingAssistants') }}</p>
              <p class="text-body-2 text-medium-emphasis mb-3">{{ t('settings.aiCodingAssistantsDesc') }}</p>
              <CliDetectionList
                :instances="settingsStore.allCliInstances"
                :enabled="settingsStore.enabledClis"
                :loading="settingsStore.detectingClis"
                @refresh="settingsStore.refreshCliDetection()"
                @toggle="settingsStore.toggleCli($event)"
              />
            </v-sheet>
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.defaultCliInstance') }}</p>
              <p v-if="availableDistros.length === 0" class="text-body-2 text-medium-emphasis">—</p>
              <v-select
                v-else
                :model-value="settingsStore.defaultCliInstance || (availableDistros[0] ? `${availableDistros[0].cli}:${availableDistros[0].distro}` : '')"
                :items="availableDistroItems"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="(v) => onDefaultCliChange(v as string)"
              />
            </v-sheet>
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-1">{{ t('settings.opencodeDefaultModel') }}</p>
              <p class="text-body-2 text-medium-emphasis mb-2">{{ t('settings.opencodeDefaultModelHint') }}</p>
              <v-text-field
                :model-value="settingsStore.opencodeDefaultModel"
                placeholder="anthropic/claude-opus-4-5"
                variant="outlined"
                density="compact"
                hide-details
                @blur="(e: FocusEvent) => store.dbPath && settingsStore.setOpencodeDefaultModel(store.dbPath, (e.target as HTMLInputElement).value)"
              />
            </v-sheet>
          </div>

          <!-- ── notifications ── -->
          <div v-show="activeSection === 'notifications'" class="d-flex flex-column ga-3">
            <v-sheet rounded="lg" border class="pa-4">
              <div class="d-flex align-center justify-space-between ga-4">
                <div>
                  <p class="text-body-2 font-weight-medium">{{ t('settings.notifications') }}</p>
                  <p class="text-body-2 text-medium-emphasis">{{ t('settings.notificationsDesc') }}</p>
                </div>
                <v-switch
                  hide-details
                  density="compact"
                  color="primary"
                  :model-value="settingsStore.notificationsEnabled"
                  @update:model-value="settingsStore.setNotificationsEnabled(Boolean($event))"
                />
              </div>
            </v-sheet>
          </div>

          <!-- ── application ── -->
          <div v-show="activeSection === 'application'" class="d-flex flex-column ga-3">
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
                  class="text-body-2 font-weight-medium"
                  :class="{
                    'text-warning': updaterStatus === 'available' || updaterStatus === 'downloaded' || updaterStatus === 'downloading',
                    'text-secondary': updaterStatus === 'up-to-date',
                    'text-error': updaterStatus === 'error',
                  }"
                >{{
                  updaterStatus === 'up-to-date' ? t('settings.upToDate') :
                  updaterStatus === 'available' ? t('settings.updateAvailable') :
                  updaterStatus === 'downloading' ? t('settings.downloading') :
                  updaterStatus === 'downloaded' ? t('settings.downloaded') :
                  updaterStatus === 'error' ? t('settings.updateError') : ''
                }}</span>
              </div>
            </v-sheet>
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.about') }}</p>
              <p class="text-body-2 text-medium-emphasis">
                {{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}
              </p>
              <p class="text-body-2 text-medium-emphasis mt-1">{{ t('settings.aboutDesc') }}</p>
            </v-sheet>
            <v-sheet v-if="store.dbPath" rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-3">{{ t('settings.exportData') }}</p>
              <v-btn
                color="primary"
                prepend-icon="mdi-download"
                :disabled="exporting"
                @click="showExportConfirm = true"
              >
                {{ exporting ? t('settings.exporting') : t('settings.exportBtn') }}
              </v-btn>
            </v-sheet>
            <v-sheet v-if="store.dbPath" rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.database') }}</p>
              <p
                class="text-body-2 text-medium-emphasis"
                style="font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace; word-break: break-all;"
              >
{{ store.dbPath }}
</p>
            </v-sheet>
          </div>
</div>
      </div>
</v-card>
  </v-dialog>

  <!-- ── Export confirmation dialog ── -->
  <v-dialog v-model="showExportConfirm" max-width="360">
    <v-card>
      <v-card-title class="text-body-1 font-weight-medium">
        {{ t('settings.exportConfirmTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-2">{{ t('settings.exportConfirmMsg') }}</p>
        <p class="text-caption text-warning">{{ t('settings.exportConfirmWarn') }}</p>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="showExportConfirm = false">
          {{ t('settings.exportCancel') }}
        </v-btn>
        <v-btn color="primary" @click="exportZip">
          {{ t('settings.exportConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Flex overflow fix — no Vuetify utility for min-height: 0 */
.settings-body { min-height: 0; }
/* Narrow numeric inputs — no fixed-pixel class in Vuetify */
.threshold-input { max-width: 80px; }
.count-input { max-width: 96px; }
</style>
