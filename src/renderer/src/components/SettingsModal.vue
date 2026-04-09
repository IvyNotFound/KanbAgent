<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, type Language, type Theme } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import CliDetectionList from '@renderer/components/CliDetectionList.vue'
import { useUpdater } from '@renderer/composables/useUpdater'
import { CLI_CAPABILITIES, CLI_LABELS } from '@renderer/utils/cliCapabilities'
import type { CliType } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

type Section = 'appearance' | 'automation' | 'editor' | 'cli' | 'models' | 'notifications' | 'application'
const activeSection = ref<Section>('appearance')

const sections: Array<{ id: Section; labelKey: string }> = [
  { id: 'appearance', labelKey: 'settings.sections.appearance' },
  { id: 'automation', labelKey: 'settings.sections.automation' },
  { id: 'editor', labelKey: 'settings.sections.editor' },
  { id: 'cli', labelKey: 'settings.sections.cli' },
  { id: 'models', labelKey: 'settings.sections.models' },
  { id: 'notifications', labelKey: 'settings.sections.notifications' },
  { id: 'application', labelKey: 'settings.sections.application' },
]

const SECTION_ICONS: Record<Section, string> = {
  appearance: 'mdi-white-balance-sunny',
  automation: 'mdi-lightning-bolt',
  editor: 'mdi-file-document-outline',
  cli: 'mdi-console',
  models: 'mdi-brain',
  notifications: 'mdi-bell-outline',
  application: 'mdi-information-outline',
}

const showExportConfirm = ref(false)
const exporting = ref(false)
const regenerating = ref(false)

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

async function regenerateRulesFiles() {
  if (!store.projectPath) return
  regenerating.value = true
  try {
    const detectedClis = settingsStore.allCliInstances.map(i => i.cli)
    const uniqueClis = [...new Set(detectedClis)]
    const result = await window.electronAPI.projectRegenerateRulesFiles(
      store.projectPath,
      uniqueClis,
      settingsStore.language,
    )
    if (result.success && result.filesCreated) {
      emit('toast', t('settings.regenerateSuccess', { files: result.filesCreated.join(', ') }), 'success')
    } else {
      emit('toast', t('settings.regenerateError', { error: result.error ?? 'Unknown error' }), 'error')
    }
  } catch (err) {
    emit('toast', t('settings.regenerateError', { error: String(err) }), 'error')
  } finally {
    regenerating.value = false
  }
}

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

// Per-CLI model selectors (T1803)
const modelCapableClis = computed<CliType[]>(() =>
  settingsStore.enabledClis.filter(cli => CLI_CAPABILITIES[cli]?.modelSelection)
)

// All CLIs that support model selection, regardless of enabled state (T1824)
const allModelCapableClis = computed<CliType[]>(() =>
  (Object.keys(CLI_CAPABILITIES) as CliType[]).filter(cli => CLI_CAPABILITIES[cli]?.modelSelection)
)

function modelItems(cli: CliType): Array<{ title: string; value: string }> {
  return (settingsStore.cliModels[cli] as CliModelDef[] ?? []).map(m => ({
    title: m.label,
    value: m.modelId,
  }))
}

onMounted(async () => {
  await settingsStore.refreshCliDetection()
  if (store.dbPath) {
    await Promise.all([
      settingsStore.loadDefaultModels(store.dbPath),
      settingsStore.loadCliModels(),
    ])
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

      <!-- Header -->
      <v-toolbar density="compact" flat color="surface">
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

      <!-- Body: nav rail + content panel -->
      <div class="settings-body d-flex flex-grow-1">

        <!-- Nav rail -->
        <v-list
          nav
          density="compact"
          bg-color="transparent"
          :width="200"
          class="flex-shrink-0 pa-2"
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
        <div class="settings-content pa-4 d-flex flex-column ga-3">

          <!-- Appearance: Language + Theme -->
          <template v-if="activeSection === 'appearance'">
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
          </template>

          <!-- Automation: Auto-launch + Auto-review + Worktree -->
          <template v-else-if="activeSection === 'automation'">
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

          <!-- Editor: Max file lines -->
          <template v-else-if="activeSection === 'editor'">
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
                  style="width: 96px"
                  data-testid="max-file-lines-count"
                  @update:model-value="(v) => settingsStore.setMaxFileLinesCount(Number(v))"
                />
              </div>
            </v-sheet>
          </template>

          <!-- CLI & Agents -->
          <template v-else-if="activeSection === 'cli'">
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
            <v-sheet v-if="store.projectPath" rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-1">{{ t('settings.regenerateRules') }}</p>
              <p class="text-body-2 text-medium-emphasis mb-3">{{ t('settings.regenerateRulesDesc') }}</p>
              <v-btn
                color="primary"
                prepend-icon="mdi-file-refresh-outline"
                :disabled="regenerating"
                @click="regenerateRulesFiles"
              >
                {{ regenerating ? t('settings.regenerating') : t('settings.regenerateRulesBtn') }}
              </v-btn>
            </v-sheet>
            <v-sheet rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.defaultCliInstance') }}</p>
              <div v-if="availableDistros.length === 0" class="text-body-2 text-medium-emphasis">—</div>
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
          </template>

          <!-- Models (T1824) -->
          <template v-else-if="activeSection === 'models'">
            <v-sheet v-for="cli in allModelCapableClis" :key="cli" rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-1">
                {{ CLI_LABELS[cli] }} — {{ t('settings.defaultModel') }}
              </p>
              <template v-if="settingsStore.enabledClis.includes(cli)">
                <p class="text-body-2 text-medium-emphasis mb-2">
                  {{ t('settings.defaultModelHint', { cli: CLI_LABELS[cli] }) }}
                </p>
                <v-select
                  v-if="modelItems(cli).length > 0"
                  :model-value="settingsStore.getDefaultModel(cli) || null"
                  :items="modelItems(cli)"
                  clearable
                  :placeholder="t('settings.cliDefault')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="(v: string | null) => store.dbPath && settingsStore.setDefaultModel(store.dbPath, cli, v ?? '')"
                />
                <v-text-field
                  v-else
                  :model-value="settingsStore.getDefaultModel(cli)"
                  :placeholder="t('settings.cliDefault')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @blur="(e: FocusEvent) => store.dbPath && settingsStore.setDefaultModel(store.dbPath, cli, (e.target as HTMLInputElement).value)"
                />
              </template>
              <template v-else>
                <p class="text-body-2 text-medium-emphasis mb-2">
                  {{ t('settings.modelsHint') }}
                </p>
                <v-select
                  disabled
                  :placeholder="t('settings.cliDefault')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </template>
            </v-sheet>
          </template>

          <!-- Notifications -->
          <template v-else-if="activeSection === 'notifications'">
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
          </template>

          <!-- Application: Updates + About + Export + DB -->
          <template v-else-if="activeSection === 'application'">
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
                >{{ updaterStatus === 'checking' ? t('settings.checking') : t('settings.check') }}</v-btn>
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
                :disabled="exporting"
                @click="showExportConfirm = true"
              >{{ exporting ? t('settings.exporting') : t('settings.exportBtn') }}</v-btn>
            </v-sheet>
            <v-sheet v-if="store.dbPath" rounded="lg" border class="pa-4">
              <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.database') }}</p>
              <p class="text-body-2 text-medium-emphasis" style="font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace; word-break: break-all;">{{ store.dbPath }}</p>
            </v-sheet>
          </template>

        </div>
      </div>
    </v-card>
  </v-dialog>

  <!-- Export confirmation dialog -->
  <v-dialog v-model="showExportConfirm" max-width="360">
    <v-card class="pa-5">
      <h3 class="text-body-1 font-weight-medium mb-2">{{ t('settings.exportConfirmTitle') }}</h3>
      <p class="text-body-2 text-medium-emphasis mb-2">{{ t('settings.exportConfirmMsg') }}</p>
      <p class="text-caption text-warning mb-4">{{ t('settings.exportConfirmWarn') }}</p>
      <div class="d-flex ga-2 justify-end">
        <v-btn variant="text" @click="showExportConfirm = false">{{ t('settings.exportCancel') }}</v-btn>
        <v-btn color="primary" @click="exportZip">{{ t('settings.exportConfirm') }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Layout constraints — no Vuetify utility equivalent for these flex overrides */
.settings-body {
  min-height: 0;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
}
</style>
