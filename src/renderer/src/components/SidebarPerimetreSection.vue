<script setup lang="ts">
/**
 * SidebarPerimetreSection — section périmètres de la sidebar (T815).
 * Gère : liste, filtrage, édition et ajout de périmètres.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'
import type { Perimetre } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

// ── Périmètre editor ─────────────────────────────────────────────────────────
const editPerimetre = ref<Perimetre | null>(null)
const editPerimetreName = ref('')
const editPerimetreDesc = ref('')
const savingPerimetre = ref(false)

const taskCountByPerimetre = computed(() => {
  const map = new Map<string, number>()
  for (const task of store.tasks) {
    if (task.status !== 'archived' && task.scope) {
      map.set(task.scope, (map.get(task.scope) ?? 0) + 1)
    }
  }
  return map
})

const agentCountByPerimetre = computed(() => {
  const map = new Map<string, number>()
  for (const a of store.agents) {
    if (a.scope) {
      map.set(a.scope, (map.get(a.scope) ?? 0) + 1)
    }
  }
  return map
})

function openEditPerimetre(p: Perimetre) {
  editPerimetre.value = p
  editPerimetreName.value = p.name
  editPerimetreDesc.value = p.description ?? ''
}

async function savePerimetre() {
  if (!editPerimetre.value || !store.dbPath || !editPerimetreName.value.trim()) return
  savingPerimetre.value = true
  try {
    await window.electronAPI.updatePerimetre(
      store.dbPath,
      editPerimetre.value.id,
      editPerimetre.value.name,
      editPerimetreName.value.trim(),
      editPerimetreDesc.value
    )
    await store.refresh()
  } finally {
    savingPerimetre.value = false
    editPerimetre.value = null
  }
}

async function addPerimetre() {
  const confirmed = await window.electronAPI.showConfirmDialog({
    title: t('sidebar.addPerimeterTitle'),
    message: t('sidebar.addPerimeterMessage'),
    detail: t('sidebar.addPerimeterDetail'),
  })
  if (!confirmed) return
  tabsStore.addTerminal(
    'arch',
    undefined,
    'Tu es l\'agent arch. Crée un nouveau périmètre dans ce projet : mets à jour la table perimetres dans .claude/project.db et le CLAUDE.md si nécessaire. Demande d\'abord le nom et la description du périmètre.'
  )
}
</script>

<template>
  <div class="perimetre-section">
    <div v-if="store.selectedPerimetre !== null" class="reset-row">
      <button class="reset-btn" @click="store.selectedPerimetre = null">{{ t('sidebar.reset') }}</button>
    </div>

    <div v-for="p in store.perimetresData" :key="p.id" class="perimetre-item">
      <div class="perimetre-row-wrap">
        <button
          :class="['perimetre-btn', store.selectedPerimetre === p.name ? 'perimetre-btn--selected' : '']"
          :style="store.selectedPerimetre === p.name ? { backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) } : {}"
          @click="store.togglePerimetreFilter(p.name)"
        >
          <div class="perimetre-row">
            <span class="perimetre-name" :style="{ color: agentFg(p.name) }">{{ p.name }}</span>
            <div class="perimetre-badges">
              <span
                v-if="(agentCountByPerimetre.get(p.name) ?? 0) > 0"
                class="perimetre-badge"
                :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                :title="t('sidebar.nbAgents', agentCountByPerimetre.get(p.name) ?? 0, { named: { n: agentCountByPerimetre.get(p.name) ?? 0 } })"
              >
                <v-icon size="10" class="badge-icon">mdi-account</v-icon>
                {{ agentCountByPerimetre.get(p.name) ?? 0 }}
              </span>
              <span
                v-if="(taskCountByPerimetre.get(p.name) ?? 0) > 0"
                class="perimetre-badge"
                :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                :title="t('sidebar.nbActiveTasks', taskCountByPerimetre.get(p.name) ?? 0, { named: { n: taskCountByPerimetre.get(p.name) ?? 0 } })"
              >
                <v-icon size="10" class="badge-icon">mdi-format-list-checks</v-icon>
                {{ taskCountByPerimetre.get(p.name) ?? 0 }}
              </span>
            </div>
          </div>
          <p v-if="p.description" class="perimetre-desc">{{ p.description }}</p>
        </button>
        <button class="edit-btn" :title="t('sidebar.editPerimeter')" @click.stop="openEditPerimetre(p)">
          <v-icon size="12" class="icon-sm">mdi-pencil</v-icon>
        </button>
      </div>
    </div>

    <div v-if="store.perimetresData.length === 0" class="no-perimeter-msg">{{ t('sidebar.noPerimeter') }}</div>

    <button class="add-btn" @click="addPerimetre">
      <v-icon size="12" class="icon-sm">mdi-plus</v-icon>
      {{ t('sidebar.addPerimeter') }}
    </button>
  </div>

  <!-- Modal édition périmètre -->
  <Teleport to="body">
    <div v-if="editPerimetre" class="modal-backdrop" @click.self="editPerimetre = null">
      <div class="modal-card elevation-8">
        <p class="modal-title">{{ t('sidebar.editPerimeter') }}</p>
        <div class="modal-field">
          <label class="modal-label">{{ t('sidebar.name') }}</label>
          <input v-model="editPerimetreName" class="modal-input" :placeholder="t('sidebar.namePlaceholder')" @keydown.esc="editPerimetre = null" />
        </div>
        <div class="modal-field">
          <label class="modal-label">{{ t('sidebar.description') }}</label>
          <input v-model="editPerimetreDesc" class="modal-input modal-input--secondary" :placeholder="t('sidebar.descriptionPlaceholder')" @keydown.enter="savePerimetre" @keydown.esc="editPerimetre = null" />
        </div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn--cancel" @click="editPerimetre = null">{{ t('common.cancel') }}</button>
          <button class="modal-btn modal-btn--save" :disabled="savingPerimetre || !editPerimetreName.trim()" @click="savePerimetre">{{ savingPerimetre ? t('common.saving') : t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.perimetre-section {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.reset-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.reset-btn {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-primary));
  background: none;
  border: none;
  cursor: pointer;
  transition: color 150ms;
}
.reset-btn:hover { color: rgba(var(--v-theme-primary), 0.7); }
.perimetre-item {
  border-radius: 6px;
}
.perimetre-row-wrap {
  position: relative;
}
.perimetre-btn {
  width: 100%;
  text-align: left;
  padding: 8px;
  padding-right: 32px;
  border-radius: 6px;
  transition: background 150ms;
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
}
.perimetre-btn:not(.perimetre-btn--selected):hover { background: var(--surface-primary); }
.perimetre-btn--selected {
  box-shadow: 0 0 0 1px var(--content-faint);
}
.perimetre-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.perimetre-name {
  font-size: 0.875rem;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.perimetre-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.perimetre-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid;
}
.badge-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.perimetre-desc {
  font-size: 0.625rem;
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.edit-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--content-faint);
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: all 150ms;
}
.edit-btn:hover { color: var(--content-secondary); background: var(--surface-tertiary); }
.perimetre-item:hover .edit-btn { opacity: 1; }
.no-perimeter-msg {
  font-size: 0.875rem;
  color: var(--content-faint);
  padding: 8px;
}
.add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--content-faint);
  transition: all 150ms;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  margin-top: 8px;
}
.add-btn:hover { color: var(--content-tertiary); background: var(--surface-primary); }
.icon-sm { width: 14px; height: 14px; }

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.modal-card {
  background: var(--surface-primary);
  border: 1px solid var(--edge-default);
  border-radius: 12px;
  padding: 20px;
  width: 384px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--content-secondary);
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.modal-label {
  font-size: 0.75rem;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.modal-input {
  width: 100%;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.875rem;
  color: var(--content-primary);
  font-family: monospace;
  outline: none;
  box-sizing: border-box;
}
.modal-input:focus { box-shadow: 0 0 0 1px rgb(var(--v-theme-primary)); }
.modal-input--secondary { color: var(--content-tertiary); font-family: inherit; }
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.modal-btn {
  padding: 6px 12px;
  font-size: 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  border: none;
  transition: all 150ms;
}
.modal-btn--cancel {
  color: var(--content-muted);
  background: none;
}
.modal-btn--cancel:hover { color: var(--content-secondary); background: var(--surface-secondary); }
.modal-btn--save {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
.modal-btn--save:hover { filter: brightness(1.1); }
.modal-btn--save:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
