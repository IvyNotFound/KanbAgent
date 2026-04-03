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
      <div class="logo-wrap">
        <v-icon class="logo-icon" size="32">mdi-shield-check</v-icon>
      </div>
      <div class="home-titles ga-1">
        <h2 class="app-name text-h6">KanbAgent</h2>
        <p class="app-tagline text-body-2">{{ t('dbSelector.tagline') }}</p>
      </div>

      <!-- 2 options -->
      <div class="action-grid ga-3">
        <!-- Ouvrir existant -->
        <v-btn variant="text" class="action-card ga-2 py-4 px-5" @click="store.selectProject()">
          <div class="action-icon-wrap">
            <v-icon class="action-icon" size="20">mdi-folder-outline</v-icon>
          </div>
          <div>
            <p class="action-label text-body-2">{{ t('dbSelector.open') }}</p>
            <p class="action-sublabel text-caption">{{ t('dbSelector.existingProject') }}</p>
          </div>
        </v-btn>

        <!-- Créer nouveau -->
        <v-btn variant="text" class="action-card action-card--primary ga-2 py-4 px-5" @click="step = 'create'">
          <div class="action-icon-wrap action-icon-wrap--primary">
            <v-icon class="action-icon action-icon--primary" size="20">mdi-plus</v-icon>
          </div>
          <div>
            <p class="action-label action-label--primary text-body-2">{{ t('dbSelector.createNew') }}</p>
            <p class="action-sublabel text-caption">{{ t('setup.newProject') }}</p>
          </div>
        </v-btn>
      </div>

      <p v-if="store.error" class="error-msg py-2 px-3 text-caption">{{ store.error }}</p>

      <!-- Language selector -->
      <div class="lang-row">
        <select
          :value="locale"
          @change="setLocale(($event.target as HTMLSelectElement).value as Language)"
          aria-label="Language"
          class="lang-select text-caption"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="pt">Português</option>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="de">Deutsch</option>
          <option value="no">Norsk</option>
          <option value="it">Italiano</option>
          <option value="ar">العربية</option>
          <option value="ru">Русский</option>
          <option value="pl">Polski</option>
          <option value="sv">Svenska</option>
          <option value="fi">Suomi</option>
          <option value="da">Dansk</option>
          <option value="tr">Türkçe</option>
          <option value="zh-CN">中文（简体）</option>
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Création de projet -->
  <div v-else class="screen-center">
    <div class="create-content ga-5 px-6">
      <!-- Header -->
      <div class="create-header ga-3">
        <v-btn variant="text" size="small" class="back-btn text-caption" @click="step = 'home'">
          <v-icon class="back-icon" size="16">mdi-arrow-left</v-icon>
          {{ t('dbSelector.back') }}
        </v-btn>
        <h2 class="create-title text-body-1">{{ t('setup.newProject') }}</h2>
      </div>

      <!-- Explication -->
      <div class="create-info pa-3 ga-1 text-caption">
        <p>Le <code class="code-inline">CLAUDE.md</code> sera initialisé dans le dossier choisi.</p>
        <p>Un terminal <span class="code-agent">setup</span> sera lancé automatiquement pour initialiser le projet.</p>
      </div>

      <!-- Instance selector (hidden when ≤ 1 instance — auto-selected) -->
      <div v-if="availableInstances.length > 1">
        <p class="instance-label mb-2 text-caption">{{ t('dbSelector.instance') }}</p>
        <div v-if="loadingInstances" class="loading-text text-body-2">{{ t('common.loading') }}</div>
        <div v-else class="instance-list">
          <label
            v-for="inst in availableInstances"
            :key="inst.distro"
            :class="['instance-option', 'ga-3', 'py-2', 'px-3', selectedInstance?.distro === inst.distro ? 'instance-option--selected' : '']"
          >
            <input
              v-model="selectedInstance"
              type="radio"
              :value="inst"
              class="instance-radio"
            />
            <span class="instance-name">{{ getSystemLabel(inst.type, inst.distro) }}</span>
          </label>
        </div>
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
.logo-wrap {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.2);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.logo-icon {
  width: 28px;
  height: 28px;
  color: rgb(var(--v-theme-primary));
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
  border-radius: 12px !important;
  border: 1px solid var(--edge-default) !important;
  background: rgba(var(--v-theme-on-surface), 0.02) !important;
}
.action-card :deep(.v-btn__content) {
  flex-direction: column;
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
  border-radius: 8px;
  background: var(--surface-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms;
}
.action-card:hover .action-icon-wrap { background: var(--content-faint); }
.action-icon-wrap--primary { background: rgba(var(--v-theme-primary), 0.2); }
.action-card--primary:hover .action-icon-wrap--primary { background: rgba(var(--v-theme-primary), 0.3); }
.action-icon {
  width: 20px;
  height: 20px;
  color: var(--content-tertiary);
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
  border-radius: 4px;
}
.lang-row { display: flex; justify-content: center; }
.lang-select {
  background: transparent;
  color: var(--content-subtle);
  border: none;
  outline: none;
  cursor: pointer;
}

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
.back-icon { width: 14px; height: 14px; }
.create-title {
  font-weight: 600;
  color: var(--content-primary);
}
.create-info {
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: var(--content-muted);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
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
.instance-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.instance-option {
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--edge-default);
  cursor: pointer;
  transition: all 150ms;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.instance-option:hover { border-color: var(--content-faint); background: var(--surface-secondary); }
.instance-option--selected {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.08);
}
.instance-radio { accent-color: rgb(var(--v-theme-primary)); }
.instance-name {
  font-size: 0.875rem;
  font-family: monospace;
  color: var(--content-secondary);
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
