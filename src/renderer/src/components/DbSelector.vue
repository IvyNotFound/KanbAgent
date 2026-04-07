<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useProjectStore } from '@renderer/stores/project'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { systemLabel as getSystemLabel } from '@renderer/utils/cliCapabilities'
import type { Language } from '@renderer/stores/settings'
import type { CliInstance } from '@shared/cli-types'

const { t, locale } = useI18n()
const store = useTasksStore()
const projectStore = useProjectStore()
const tabsStore = useTabsStore()
const settingsStore = useSettingsStore()

function setLocale(lang: Language) {
  settingsStore.setLanguage(lang)
}

const langItems = [
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
]

const step = ref<'home' | 'create'>('home')
const selectedInstance = ref<CliInstance | null>(null)
const loadingInstances = ref(false)
const creating = ref(false)
const creatingError = ref<string | null>(null)

/**
 * Deduplicated list of available CLI instances, filtered by unique distro.
 *
 * For the setup terminal only the environment (distro) matters — CLI binary
 * differences within the same distro are irrelevant. Hidden in the template
 * when ≤ 1 instance is available (the single instance is auto-selected in
 * `onMounted`).
 */
const availableInstances = computed(() => {
  const seen = new Set<string>()
  return settingsStore.allCliInstances.filter(i => {
    if (seen.has(i.distro)) return false
    seen.add(i.distro)
    return true
  })
})

/**
 * Trigger CLI detection and apply auto-selection.
 *
 * - If the store cache is empty (first mount), fires `refreshCliDetection()`
 *   to populate `allCliInstances`.
 * - Auto-selects the only available instance when exactly one environment
 *   is detected, so the user can proceed without manual selection.
 */
onMounted(async () => {
  loadingInstances.value = true
  if (settingsStore.allCliInstances.length === 0) {
    await settingsStore.refreshCliDetection()
  }
  if (availableInstances.value.length === 1) {
    selectedInstance.value = availableInstances.value[0]
  }
  loadingInstances.value = false
})

async function create() {
  creating.value = true
  creatingError.value = null
  try {
    const path = await window.electronAPI.selectNewProjectDir()
    if (!path) { creating.value = false; return }

    const result = await window.electronAPI.initNewProject(path)
    if (!result.success) {
      creatingError.value = result.error ?? 'Erreur lors de l\'initialisation'
      creating.value = false
      return
    }

    const wslDistro = selectedInstance.value?.type === 'wsl' ? selectedInstance.value.distro : undefined
    projectStore.setProjectPathOnly(path)
    tabsStore.addTerminal('setup', wslDistro, 'Initialisation d\'un nouveau projet passe en mode setup')
    store.watchForDb(path)
  } catch (e) {
    creatingError.value = String(e)
    creating.value = false
  }
}
</script>

<template>
  <!-- Accueil -->
  <div v-if="step === 'home'" class="screen-center">
    <div class="home-content ga-6 px-6">
      <!-- Logo -->
      <v-avatar size="56" color="primary-container" class="logo-avatar">
        <v-icon size="28" color="on-primary-container">mdi-shield-check</v-icon>
      </v-avatar>
      <div class="home-titles ga-1">
        <h2 class="app-name text-h6">KanbAgent</h2>
        <p class="app-tagline text-body-2">{{ t('dbSelector.tagline') }}</p>
      </div>

      <!-- 2 options -->
      <div class="action-grid ga-3">
        <!-- Ouvrir existant -->
        <v-card variant="outlined" class="action-card pa-4" @click="store.selectProject()">
          <div class="action-card-inner ga-2">
            <div class="action-icon-wrap">
              <v-icon class="action-icon" size="20">mdi-folder-outline</v-icon>
            </div>
            <div>
              <p class="action-label text-body-2">{{ t('dbSelector.open') }}</p>
              <p class="action-sublabel text-caption">{{ t('dbSelector.existingProject') }}</p>
            </div>
          </div>
        </v-card>

        <!-- Créer nouveau -->
        <v-card variant="outlined" class="action-card action-card--primary pa-4" @click="step = 'create'">
          <div class="action-card-inner ga-2">
            <div class="action-icon-wrap action-icon-wrap--primary">
              <v-icon class="action-icon action-icon--primary" size="20">mdi-plus</v-icon>
            </div>
            <div>
              <p class="action-label action-label--primary text-body-2">{{ t('dbSelector.createNew') }}</p>
              <p class="action-sublabel text-caption">{{ t('setup.newProject') }}</p>
            </div>
          </div>
        </v-card>
      </div>

      <p v-if="store.error" class="error-msg py-2 px-3 text-caption">{{ store.error }}</p>

      <!-- Language selector -->
      <div class="lang-row">
        <v-select
          :model-value="locale"
          :items="langItems"
          item-title="label"
          item-value="code"
          density="compact"
          variant="outlined"
          hide-details
          aria-label="Language"
          style="max-width: 220px"
          @update:model-value="setLocale"
        />
      </div>
    </div>
  </div>

  <!-- Création de projet -->
  <div v-else class="screen-center">
    <div class="create-content ga-5 px-6">
      <!-- Header -->
      <div class="create-header ga-3">
        <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" class="back-btn text-caption" @click="step = 'home'">
          {{ t('dbSelector.back') }}
        </v-btn>
        <h2 class="create-title text-body-1">{{ t('setup.newProject') }}</h2>
      </div>

      <!-- Explication -->
      <v-alert variant="tonal" color="surface-variant" density="compact" class="text-caption create-info">
        <p>Le <code class="code-inline">CLAUDE.md</code> sera initialisé dans le dossier choisi.</p>
        <p>Un terminal <span class="code-agent">setup</span> sera lancé automatiquement pour initialiser le projet.</p>
      </v-alert>

      <!-- Instance selector (hidden when ≤ 1 instance — auto-selected) -->
      <div v-if="availableInstances.length > 1">
        <p class="instance-label mb-2 text-caption">{{ t('dbSelector.instance') }}</p>
        <div v-if="loadingInstances" class="loading-text text-body-2">{{ t('common.loading') }}</div>
        <v-radio-group v-else v-model="selectedInstance" hide-details>
          <v-radio
            v-for="inst in availableInstances"
            :key="inst.distro"
            :value="inst"
            :label="getSystemLabel(inst.type, inst.distro)"
            color="primary"
            density="compact"
          />
        </v-radio-group>
      </div>

      <!-- Bouton lancer -->
      <v-btn
        color="primary"
        block
        class="create-btn ga-2"
        :disabled="creating || loadingInstances || (availableInstances.length > 1 && !selectedInstance)"
        @click="create"
      >
        <v-progress-circular v-if="creating" class="btn-spinner" indeterminate :size="14" :width="2" />
        <v-icon v-else class="btn-icon" size="18">mdi-folder-outline</v-icon>
        {{ creating ? t('setup.creating') : t('dbSelector.selectAndInit') }}
      </v-btn>

      <p v-if="creatingError" class="error-msg py-2 px-3 text-caption">{{ creatingError }}</p>
    </div>
  </div>
</template>

<style scoped>
.screen-center {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.home-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  max-width: 320px;
}
.logo-avatar {
  margin: 0 auto;
}
.home-titles { display: flex; flex-direction: column; }
.app-name {
  font-weight: 600;
  color: var(--content-primary);
}
.app-tagline {
  color: var(--content-subtle);
}
.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.action-card {
  height: auto !important;
  border-radius: var(--shape-md) !important;
  border: 1px solid var(--edge-default) !important;
  background: rgba(var(--v-theme-on-surface), 0.02) !important;
  cursor: pointer;
}
.action-card-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.action-card:hover {
  border-color: var(--content-subtle) !important;
  background: var(--surface-secondary) !important;
}
.action-card--primary {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.05);
}
.action-card--primary:hover {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.1);
}
.action-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: var(--shape-sm);
  background: rgba(var(--v-theme-secondary), 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--md-duration-short3) var(--md-easing-standard);
}
.action-card:hover .action-icon-wrap { background: var(--content-faint); }
.action-icon-wrap--primary { background: rgba(var(--v-theme-primary), 0.2); }
.action-card--primary:hover .action-icon-wrap--primary { background: rgba(var(--v-theme-primary), 0.3); }
.action-icon {
  width: 20px;
  height: 20px;
  color: rgb(var(--v-theme-secondary));
}
.action-icon--primary { color: rgb(var(--v-theme-primary)); }
.action-label {
  font-weight: 500;
  color: var(--content-secondary);
}
.action-label--primary { color: rgb(var(--v-theme-primary)); }
.action-sublabel {
  color: var(--content-subtle);
  margin-top: 2px;
}
.error-msg {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.1);
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: var(--shape-xs);
}
.lang-row { display: flex; justify-content: center; }

/* Create project screen */
.create-content {
  display: flex;
  flex-direction: column;
  max-width: 320px;
  width: 100%;
}
.create-header {
  display: flex;
  align-items: center;
}
.back-btn {
  gap: 6px;
  color: var(--content-subtle) !important;
}
.create-title {
  font-weight: 600;
  color: var(--content-primary);
}
.create-info {
  line-height: 1.6;
}
.code-inline {
  font-family: monospace;
  color: rgb(var(--v-theme-primary));
  background: var(--surface-primary);
  padding: 1px 4px;
  border-radius: 3px;
}
.code-agent {
  color: rgb(var(--v-theme-primary));
  font-family: monospace;
  font-weight: 600;
}
.instance-label {
  font-weight: 600;
  color: var(--content-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.loading-text {
  color: var(--content-subtle);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.btn-spinner {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.btn-icon { width: 16px; height: 16px; }
</style>
