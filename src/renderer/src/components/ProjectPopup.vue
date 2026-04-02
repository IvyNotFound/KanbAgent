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
  <v-dialog model-value max-width="320" @update:model-value="emit('close')">
    <div
      data-testid="project-popup-backdrop"
      @click.self="emit('close')"
    >
      <!-- Card -->
      <div class="popup-card elevation-8">
        <!-- Header -->
        <div class="popup-header">
          <div class="popup-header-left">
            <div class="popup-icon">
              <v-icon class="icon-sm" size="16">mdi-folder-outline</v-icon>
            </div>
            <h2 class="popup-title">{{ t('project.activeTitle') }}</h2>
          </div>
          <button
            class="popup-close"
            :title="t('common.close')"
            @click="emit('close')"
          >
            <v-icon class="icon-xs" size="14">mdi-close</v-icon>
          </button>
        </div>

        <!-- Body -->
        <div class="popup-body">
          <!-- Project info -->
          <div class="project-info">
            <p class="project-name" :title="store.projectPath ?? undefined">
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
          <div v-if="store.error" class="project-error">
            <p class="project-error-text">{{ store.error }}</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="popup-footer">
          <button
            class="btn-change"
            @click="handleChangeProject"
          >
            <v-icon class="icon-xs" size="14">mdi-folder-outline</v-icon>
            {{ t('project.changeProject') }}
          </button>
          <button
            v-if="store.projectPath"
            class="btn-close-project"
            @click="handleCloseProject"
          >
            <v-icon class="icon-xs" size="14">mdi-close</v-icon>
            {{ t('project.close') }}
          </button>
          <p class="popup-version">v{{ appVersion }}</p>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.popup-card {
  background-color: var(--surface-primary);
  border: 1px solid var(--edge-default);
  border-radius: 12px;
  width: 20rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.popup-header {
  padding: 16px 20px;
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
  border-radius: 8px;
  background-color: var(--surface-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--content-muted);
}

.popup-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--content-primary);
  margin: 0;
}

.popup-close {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--content-subtle);
  transition: color 0.15s, background-color 0.15s;
}
.popup-close:hover {
  color: var(--content-secondary);
  background-color: var(--surface-secondary);
}

/* Body */
.popup-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-name {
  font-size: 0.875rem;
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
  color: #d97706;
  font-family: ui-monospace, monospace;
  margin: 0;
}

.project-error {
  padding: 8px 12px;
  background-color: rgba(127, 29, 29, 0.25);
  border: 1px solid rgba(127, 29, 29, 0.5);
  border-radius: 6px;
}
.project-error-text {
  font-size: 0.75rem;
  color: #f87171;
  word-break: break-all;
  margin: 0;
}

/* Footer */
.popup-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--edge-subtle);
  background-color: rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-change,
.btn-close-project {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  border: 1px solid transparent;
}

.btn-change {
  background-color: var(--surface-secondary);
  color: var(--content-primary);
  border-color: var(--edge-subtle);
}
.btn-change:hover {
  background-color: var(--surface-tertiary);
}

.btn-close-project {
  background-color: transparent;
  color: #f87171;
  border-color: rgba(127, 29, 29, 0.3);
}
.btn-close-project:hover {
  color: #fca5a5;
  background-color: rgba(127, 29, 29, 0.15);
  border-color: rgba(185, 28, 28, 0.5);
}

.popup-version {
  font-size: 0.6875rem;
  color: var(--content-faint);
  font-family: ui-monospace, monospace;
  text-align: right;
  padding-top: 4px;
  margin: 0;
}

.icon-sm {
  width: 1rem;
  height: 1rem;
}
.icon-xs {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}
</style>
