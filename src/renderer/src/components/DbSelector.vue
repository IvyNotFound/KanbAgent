<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useProjectStore } from '@renderer/stores/project'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Language } from '@renderer/stores/settings'

const { t, locale } = useI18n()
const store = useTasksStore()
const projectStore = useProjectStore()
const tabsStore = useTabsStore()
const settingsStore = useSettingsStore()

function setLocale(lang: Language) {
  settingsStore.setLanguage(lang)
}

const step = ref<'home' | 'create'>('home')
const wslUsers = ref<string[]>([])
const selectedUser = ref<string | null>(null)
const loadingUsers = ref(false)
const creating = ref(false)
const creatingError = ref<string | null>(null)

onMounted(async () => {
  loadingUsers.value = true
  wslUsers.value = await window.electronAPI.getWslUsers()
  if (wslUsers.value.length === 1) selectedUser.value = wslUsers.value[0]
  loadingUsers.value = false
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

    projectStore.setProjectPathOnly(path)
    tabsStore.addTerminal('setup', selectedUser.value ?? undefined, 'Initialisation d\'un nouveau projet passe en mode setup')
    store.watchForDb(path)
  } catch (e) {
    creatingError.value = String(e)
    creating.value = false
  }
}
</script>

<template>
  <!-- Accueil -->
  <div v-if="step === 'home'" class="h-full flex items-center justify-center">
    <div class="text-center space-y-6 max-w-sm px-6">
      <!-- Logo -->
      <div class="w-14 h-14 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center mx-auto">
        <svg viewBox="0 0 24 24" fill="none" class="w-7 h-7 text-violet-400">
          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <h2 class="text-xl font-semibold text-content-primary mb-1">KanbAgent</h2>
        <p class="text-sm text-content-subtle">{{ t('dbSelector.tagline') }}</p>
      </div>

      <!-- 2 options -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Ouvrir existant -->
        <button
          class="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-edge-default hover:border-content-subtle bg-surface-secondary/40 hover:bg-surface-secondary transition-all group"
          @click="store.selectProject()"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-tertiary group-hover:bg-content-faint flex items-center justify-center transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-content-tertiary">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-content-secondary">{{ t('dbSelector.open') }}</p>
            <p class="text-xs text-content-subtle mt-0.5">{{ t('dbSelector.existingProject') }}</p>
          </div>
        </button>

        <!-- Créer nouveau -->
        <button
          class="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-violet-500/30 hover:border-violet-500/60 bg-violet-500/5 hover:bg-violet-500/10 transition-all group"
          @click="step = 'create'"
        >
          <div class="w-9 h-9 rounded-lg bg-violet-500/20 group-hover:bg-violet-500/30 flex items-center justify-center transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-violet-400">
              <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-violet-600 dark:text-violet-300">{{ t('dbSelector.createNew') }}</p>
            <p class="text-xs text-content-subtle mt-0.5">{{ t('setup.newProject') }}</p>
          </div>
        </button>
      </div>

      <p v-if="store.error" class="text-xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded px-3 py-2">
        {{ store.error }}
      </p>

      <!-- Language selector -->
      <div class="flex justify-center">
        <select
          :value="locale"
          @change="setLocale(($event.target as HTMLSelectElement).value as Language)"
          aria-label="Language"
          class="bg-transparent text-content-subtle text-xs border-none focus:outline-none cursor-pointer"
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
  <div v-else class="h-full flex items-center justify-center">
    <div class="space-y-5 max-w-sm w-full px-6">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <button
          class="flex items-center gap-1.5 text-xs text-content-subtle hover:text-content-tertiary transition-colors"
          @click="step = 'home'"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
            <path fill-rule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H13a1 1 0 110 2H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
          {{ t('dbSelector.back') }}
        </button>
        <h2 class="text-base font-semibold text-content-primary">{{ t('setup.newProject') }}</h2>
      </div>

      <!-- Explication -->
      <div class="px-3 py-3 rounded-lg bg-surface-secondary/60 border border-edge-default/50 text-xs text-content-muted leading-relaxed space-y-1">
        <p>Le <code class="text-violet-600 dark:text-violet-300 bg-surface-primary px-1 rounded">CLAUDE.md</code> sera initialisé dans le dossier choisi.</p>
        <p>Un terminal <span class="text-violet-600 dark:text-violet-300 font-mono">setup</span> sera lancé automatiquement pour initialiser le projet.</p>
      </div>

      <!-- WSL user -->
      <div>
        <p class="text-xs font-semibold text-content-muted uppercase tracking-wider mb-2">{{ t('dbSelector.wslUser') }}</p>

        <div v-if="loadingUsers" class="text-sm text-content-subtle animate-pulse">{{ t('common.loading') }}</div>

        <div v-else-if="wslUsers.length === 0" class="text-sm text-content-subtle italic px-1">
          {{ t('dbSelector.noUser') }}
        </div>

        <div v-else class="space-y-1.5">
          <label
            v-for="user in wslUsers"
            :key="user"
            class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all"
            :class="selectedUser === user
              ? 'border-violet-500/60 bg-violet-100 dark:bg-violet-950/30'
              : 'border-edge-default hover:border-content-faint bg-surface-secondary/40'"
          >
            <input
              v-model="selectedUser"
              type="radio"
              :value="user"
              class="accent-violet-500"
            />
            <span class="text-sm font-mono text-content-secondary">{{ user }}</span>
          </label>
        </div>
      </div>

      <!-- Bouton lancer -->
      <button
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
        :disabled="creating || loadingUsers || (wslUsers.length > 0 && !selectedUser)"
        @click="create"
      >
        <svg v-if="creating" class="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
          <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
        </svg>
        {{ creating ? t('setup.creating') : t('dbSelector.selectAndInit') }}
      </button>

      <p v-if="creatingError" class="text-xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded px-3 py-2">
        {{ creatingError }}
      </p>
    </div>
  </div>
</template>
