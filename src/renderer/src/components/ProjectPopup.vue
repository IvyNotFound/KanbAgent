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
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'

const { t } = useI18n()

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
      title: t('project.closeTitle'),
      message: t('project.closeMessage', n, { named: { n } }),
      detail: t('project.closeDetail'),
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
  <v-dialog model-value max-width="420" @update:model-value="emit('close')">
    <div
      data-testid="project-popup-backdrop"
      @click.self="emit('close')"
    >
      <!-- Card -->
      <v-card class="popup-card" elevation="2">
        <!-- Header -->
        <div class="popup-header py-4 px-5">
          <div class="popup-header-left">
            <div class="popup-icon">
              <v-icon size="16" :style="{ color: 'rgb(var(--v-theme-on-surface-variant))' }">mdi-folder-outline</v-icon>
            </div>
            <h2 class="popup-title text-subtitle-2">{{ t('project.activeTitle') }}</h2>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            density="compact"
            class="popup-close"
            :title="t('common.close')"
            @click="emit('close')"
          />
        </div>

        <!-- Body -->
        <div class="popup-body py-4 px-5 ga-3">
          <!-- Project info -->
          <div class="project-info ga-1">
            <p class="project-name text-body-2" :title="store.projectPath ?? undefined">
              {{ projectName }}
            </p>
            <p
              v-if="store.dbPath"
              class="project-path"
              :title="store.dbPath"
            >
              {{ store.dbPath }}
            </p>
            <p v-else-if="store.projectPath" class="project-initializing">
              {{ t('sidebar.initializing') }}
            </p>
          </div>

          <!-- Error -->
          <div v-if="store.error" class="project-error py-2 px-3">
            <p class="project-error-text text-caption">{{ store.error }}</p>
          </div>
        </div>

        <!-- Footer — MD3: horizontal actions right-aligned, version text left -->
        <v-card-actions class="popup-footer px-4 py-3">
          <p class="popup-version">v{{ appVersion }}</p>
          <v-spacer />
          <v-btn
            variant="text"
            color="primary"
            class="btn-change px-4"
            @click="handleChangeProject"
          >
            {{ t('project.changeProject') }}
          </v-btn>
          <v-btn
            v-if="store.projectPath"
            color="error"
            variant="tonal"
            class="btn-close-project px-4"
            @click="handleCloseProject"
          >
            {{ t('project.close') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
.popup-card {
  border-radius: var(--shape-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.popup-header {
  border-bottom: 1px solid var(--edge-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.popup-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.popup-icon {
  width: 2rem;
  height: 2rem;
  border-radius: var(--shape-sm);
  background-color: rgb(var(--v-theme-surface-variant));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.popup-title {
  font-weight: 600;
  color: var(--content-primary);
  margin: 0;
}

.popup-close {
  color: var(--content-subtle) !important;
}

/* Body */
.popup-body {
  display: flex;
  flex-direction: column;
}

.project-info {
  display: flex;
  flex-direction: column;
}

.project-name {
  font-weight: 500;
  color: var(--content-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}

.project-path {
  font-size: 0.75rem;
  color: var(--content-muted);
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}

.project-initializing {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-warning));
  font-family: ui-monospace, monospace;
  margin: 0;
}

.project-error {
  background-color: rgba(var(--v-theme-error), 0.15);
  border: 1px solid rgba(var(--v-theme-error), 0.3);
  border-radius: var(--shape-xs);
}
.project-error-text {
  color: rgb(var(--v-theme-error));
  word-break: break-all;
  margin: 0;
}

/* Footer — transparent so it inherits the card's surface-dialog background */
.popup-footer {
  border-top: 1px solid var(--edge-subtle);
  background: transparent;
}


.popup-version {
  font-size: 0.6875rem;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  margin: 0;
  align-self: center;
}

.icon-sm {
  width: 1rem;
  height: 1rem;
}
</style>
