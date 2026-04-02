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
    <div class="home-content">
      <!-- Logo -->
      <div class="logo-wrap">
        <v-icon class="logo-icon" size="32">mdi-shield-check</v-icon>
      </div>
      <div class="home-titles">
        <h2 class="app-name">KanbAgent</h2>
        <p class="app-tagline">{{ t('dbSelector.tagline') }}</p>
      </div>

      <!-- 2 options -->
      <div class="action-grid">
        <!-- Ouvrir existant -->
        <button class="action-card" @click="store.selectProject()">
          <div class="action-icon-wrap">
            <v-icon class="action-icon" size="20">mdi-folder-outline</v-icon>
          </div>
          <div>
            <p class="action-label">{{ t('dbSelector.open') }}</p>
            <p class="action-sublabel">{{ t('dbSelector.existingProject') }}</p>
          </div>
        </button>

        <!-- Créer nouveau -->
        <button class="action-card action-card--primary" @click="step = 'create'">
          <div class="action-icon-wrap action-icon-wrap--primary">
            <v-icon class="action-icon action-icon--primary" size="20">mdi-plus</v-icon>
          </div>
          <div>
            <p class="action-label action-label--primary">{{ t('dbSelector.createNew') }}</p>
            <p class="action-sublabel">{{ t('setup.newProject') }}</p>
          </div>
        </button>
      </div>

      <p v-if="store.error" class="error-msg">{{ store.error }}</p>

      <!-- Language selector -->
      <div class="lang-row">
        <select
          :value="locale"
          @change="setLocale(($event.target as HTMLSelectElement).value as Language)"
          aria-label="Language"
          class="lang-select"
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
    <div class="create-content">
      <!-- Header -->
      <div class="create-header">
        <button class="back-btn" @click="step = 'home'">
          <v-icon class="back-icon" size="16">mdi-arrow-left</v-icon>
          {{ t('dbSelector.back') }}
        </button>
        <h2 class="create-title">{{ t('setup.newProject') }}</h2>
      </div>

      <!-- Explication -->
      <div class="create-info">
        <p>Le <code class="code-inline">CLAUDE.md</code> sera initialisé dans le dossier choisi.</p>
        <p>Un terminal <span class="code-agent">setup</span> sera lancé automatiquement pour initialiser le projet.</p>
      </div>

      <!-- Instance selector (hidden when ≤ 1 instance — auto-selected) -->
      <div v-if="availableInstances.length > 1">
        <p class="instance-label">{{ t('dbSelector.instance') }}</p>
        <div v-if="loadingInstances" class="loading-text">{{ t('common.loading') }}</div>
        <div v-else class="instance-list">
          <label
            v-for="inst in availableInstances"
            :key="inst.distro"
            :class="['instance-option', selectedInstance?.distro === inst.distro ? 'instance-option--selected' : '']"
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
      <button
        class="create-btn"
        :disabled="creating || loadingInstances || (availableInstances.length > 1 && !selectedInstance)"
        @click="create"
      >
        <v-progress-circular v-if="creating" class="btn-spinner" indeterminate :size="14" :width="2" />
        <v-icon v-else class="btn-icon" size="18">mdi-folder-outline</v-icon>
        {{ creating ? t('setup.creating') : t('dbSelector.selectAndInit') }}
      </button>

      <p v-if="creatingError" class="error-msg">{{ creatingError }}</p>
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
  gap: 24px;
  max-width: 320px;
  padding: 0 24px;
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
.home-titles { display: flex; flex-direction: column; gap: 4px; }
.app-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--content-primary);
}
.app-tagline {
  font-size: 0.875rem;
  color: var(--content-subtle);
}
.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--edge-default);
  background: rgba(var(--v-theme-on-surface), 0.02);
  transition: all 150ms;
  cursor: pointer;
}
.action-card:hover {
  border-color: var(--content-subtle);
  background: var(--surface-secondary);
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
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--content-secondary);
}
.action-label--primary { color: rgb(var(--v-theme-primary)); }
.action-sublabel {
  font-size: 0.75rem;
  color: var(--content-subtle);
  margin-top: 2px;
}
.error-msg {
  font-size: 0.75rem;
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  padding: 8px 12px;
}
.lang-row { display: flex; justify-content: center; }
.lang-select {
  background: transparent;
  color: var(--content-subtle);
  font-size: 0.75rem;
  border: none;
  outline: none;
  cursor: pointer;
}

/* Create project screen */
.create-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 320px;
  width: 100%;
  padding: 0 24px;
}
.create-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 150ms;
}
.back-btn:hover { color: var(--content-tertiary); }
.back-icon { width: 14px; height: 14px; }
.create-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--content-primary);
}
.create-info {
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 0.75rem;
  color: var(--content-muted);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--content-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.loading-text {
  font-size: 0.875rem;
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
  gap: 12px;
  padding: 8px 12px;
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
.create-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  background: rgb(var(--v-theme-primary));
  color: #fff;
  border: none;
  cursor: pointer;
  transition: all 150ms;
}
.create-btn:hover { filter: brightness(1.1); }
.create-btn:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
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
