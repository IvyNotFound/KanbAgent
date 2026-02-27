/**
 * Modal popup for active project management.
 *
 * Displays the current project name, database path, and app version.
 * Provides actions to switch to another project or close the current one.
 * Emits `close` when dismissed (backdrop click, Escape key, or action button).
 *
 * @emits close - when the popup should be hidden
 */
<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'

const emit = defineEmits<{ close: [] }>()
const store = useTasksStore()
const tabsStore = useTabsStore()

const appVersion = import.meta.env.VITE_APP_VERSION as string ?? '0.0.0'

/**
 * Derives a short display name from the full project path.
 * Returns the last path segment, or '—' when no project is open.
 */
const projectName = computed(() => {
  if (!store.projectPath) return '—'
  return store.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? store.projectPath
})

/**
 * Opens the native folder-picker to select a new project, then closes the popup.
 */
async function handleChangeProject() {
  await store.selectProject()
  emit('close')
}

/**
 * Closes the current project after optional confirmation when WSL terminals are open.
 * All open terminal tabs are killed before the project is unloaded.
 */
async function handleCloseProject() {
  const openTerminals = tabsStore.tabs.filter(t => t.type === 'terminal')
  if (openTerminals.length > 0) {
    const n = openTerminals.length
    const confirmed = await window.electronAPI.showConfirmDialog({
      title: 'Fermer le projet',
      message: `${n} session${n > 1 ? 's' : ''} WSL ouverte${n > 1 ? 's' : ''}`,
      detail: 'Toutes les sessions WSL seront fermées. Continuer ?',
    })
    if (!confirmed) return
    tabsStore.closeAllTerminals()
  }
  store.closeProject()
  emit('close')
}

// Close when project path becomes null (e.g. closeProject() called from elsewhere)
watch(() => store.projectPath, (path) => {
  if (!path) emit('close')
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keyup', onKey))
onUnmounted(() => document.removeEventListener('keyup', onKey))
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150"
    leave-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
    appear
  >
    <!-- Overlay -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('close')"
    >
      <!-- Card -->
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-80 p-6 flex flex-col gap-5">

        <!-- Header -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 text-content-tertiary">
                <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
              </svg>
            </div>
            <h2 class="text-sm font-semibold text-content-primary">Projet actif</h2>
          </div>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
            title="Fermer"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Project info -->
        <div class="space-y-1">
          <p class="text-sm font-medium text-content-primary truncate" :title="store.projectPath ?? undefined">
            {{ projectName }}
          </p>
          <p
            v-if="store.dbPath"
            class="text-xs text-content-muted font-mono truncate"
            :title="store.dbPath"
          >
            {{ store.dbPath }}
          </p>
          <p v-else-if="store.projectPath" class="text-xs text-amber-500/70 font-mono">
            Initialisation en cours…
          </p>
        </div>

        <!-- Error -->
        <div v-if="store.error" class="px-3 py-2 bg-red-950/40 border border-red-800/50 rounded-md">
          <p class="text-xs text-red-400 break-all">{{ store.error }}</p>
        </div>

        <!-- Actions -->
        <div class="flex flex-col gap-2">
          <button
            class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-surface-secondary hover:bg-surface-tertiary text-content-primary transition-colors"
            @click="handleChangeProject"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
              <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
            </svg>
            Changer de projet
          </button>
          <button
            v-if="store.projectPath"
            class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-950/30 border border-red-800/30 hover:border-red-700/50 transition-colors"
            @click="handleCloseProject"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 shrink-0">
              <path d="M4.354 4.646a.5.5 0 0 0-.708.708L7.293 8l-3.647 3.646a.5.5 0 0 0 .708.708L8 8.707l3.646 3.647a.5.5 0 0 0 .708-.708L8.707 8l3.647-3.646a.5.5 0 0 0-.708-.708L8 7.293 4.354 4.646z"/>
            </svg>
            Fermer le projet
          </button>
        </div>

        <!-- Version -->
        <p class="text-[11px] text-content-faint font-mono text-right">v{{ appVersion }}</p>
      </div>
    </div>
  </Transition>
</template>
