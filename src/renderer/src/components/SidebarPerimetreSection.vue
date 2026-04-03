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
  <div class="perimetre-section py-3 px-4 ga-1">
    <div v-if="store.selectedPerimetre !== null" class="reset-row mb-2">
      <v-btn variant="text" size="small" color="primary" class="reset-btn text-caption" @click="store.selectedPerimetre = null">{{ t('sidebar.reset') }}</v-btn>
    </div>

    <div v-for="p in store.perimetresData" :key="p.id" class="perimetre-item">
      <div class="perimetre-row-wrap">
        <v-btn
          variant="text"
          block
          :class="['perimetre-btn', store.selectedPerimetre === p.name ? 'perimetre-btn--selected' : '']"
          :style="store.selectedPerimetre === p.name ? { backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) } : {}"
          @click="store.togglePerimetreFilter(p.name)"
        >
          <div class="perimetre-row ga-2">
            <span class="perimetre-name" :style="{ color: agentFg(p.name) }">{{ p.name }}</span>
            <div class="perimetre-badges">
              <span
                v-if="(agentCountByPerimetre.get(p.name) ?? 0) > 0"
                class="perimetre-badge ga-1"
                :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                :title="t('sidebar.nbAgents', agentCountByPerimetre.get(p.name) ?? 0, { named: { n: agentCountByPerimetre.get(p.name) ?? 0 } })"
              >
                <v-icon size="10" class="badge-icon">mdi-account</v-icon>
                {{ agentCountByPerimetre.get(p.name) ?? 0 }}
              </span>
              <span
                v-if="(taskCountByPerimetre.get(p.name) ?? 0) > 0"
                class="perimetre-badge ga-1"
                :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }"
                :title="t('sidebar.nbActiveTasks', taskCountByPerimetre.get(p.name) ?? 0, { named: { n: taskCountByPerimetre.get(p.name) ?? 0 } })"
              >
                <v-icon size="10" class="badge-icon">mdi-format-list-checks</v-icon>
                {{ taskCountByPerimetre.get(p.name) ?? 0 }}
              </span>
            </div>
          </div>
          <p v-if="p.description" class="perimetre-desc text-caption font-weight-medium">{{ p.description }}</p>
        </v-btn>
        <v-btn icon variant="text" density="compact" size="x-small" class="edit-btn" :title="t('sidebar.editPerimeter')" @click.stop="openEditPerimetre(p)">
          <v-icon size="12" class="icon-sm">mdi-pencil</v-icon>
        </v-btn>
      </div>
    </div>

    <div v-if="store.perimetresData.length === 0" class="no-perimeter-msg pa-2 text-body-2">{{ t('sidebar.noPerimeter') }}</div>

    <v-btn variant="text" block size="small" class="add-btn ga-2 pa-2 mt-2 text-caption" @click="addPerimetre">
      <v-icon size="12" class="icon-sm">mdi-plus</v-icon>
      {{ t('sidebar.addPerimeter') }}
    </v-btn>
  </div>

  <!-- Modal édition périmètre -->
  <Teleport to="body">
    <div v-if="editPerimetre" class="modal-backdrop" @click.self="editPerimetre = null">
      <div class="modal-card elevation-8 pa-5 ga-3">
        <p class="modal-title text-body-2">{{ t('sidebar.editPerimeter') }}</p>
        <div class="modal-field ga-1">
          <label class="modal-label text-caption">{{ t('sidebar.name') }}</label>
          <input v-model="editPerimetreName" class="modal-input" :placeholder="t('sidebar.namePlaceholder')" @keydown.esc="editPerimetre = null" />
        </div>
        <div class="modal-field ga-1">
          <label class="modal-label text-caption">{{ t('sidebar.description') }}</label>
          <input v-model="editPerimetreDesc" class="modal-input modal-input--secondary" :placeholder="t('sidebar.descriptionPlaceholder')" @keydown.enter="savePerimetre" @keydown.esc="editPerimetre = null" />
        </div>
        <div class="modal-actions ga-2">
          <v-btn variant="text" size="small" class="modal-btn modal-btn--cancel text-caption" @click="editPerimetre = null">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" size="small" :disabled="savingPerimetre || !editPerimetreName.trim()" class="modal-btn modal-btn--save text-caption" @click="savePerimetre">{{ savingPerimetre ? t('common.saving') : t('common.save') }}</v-btn>
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
  display: flex;
  flex-direction: column;
}
.reset-row {
  display: flex;
  justify-content: flex-end;
}
.perimetre-item {
  border-radius: 6px;
}
.perimetre-row-wrap {
  position: relative;
}
.perimetre-btn {
  text-align: left !important;
  padding-right: 32px !important;
  justify-content: flex-start !important;
  height: auto !important;
}
.perimetre-btn--selected {
  box-shadow: 0 0 0 1px var(--content-faint) !important;
}
.perimetre-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  color: var(--content-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.edit-btn {
  position: absolute !important;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px !important;
  min-width: 24px !important;
  height: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
  color: var(--content-faint) !important;
  opacity: 0;
}
.perimetre-item:hover .edit-btn { opacity: 1; }
.no-perimeter-msg {
  color: var(--content-faint);
}
.add-btn {
  color: var(--content-faint) !important;
  justify-content: flex-start !important;
}
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
  width: 384px;
  display: flex;
  flex-direction: column;
}
.modal-title {
  font-weight: 600;
  color: var(--content-secondary);
}
.modal-field {
  display: flex;
  flex-direction: column;
}
.modal-label {
  color: var(--content-subtle);
  letter-spacing: 0.02em;
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
  justify-content: flex-end;
}
</style>
