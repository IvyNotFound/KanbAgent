<script setup lang="ts">
/**
 * SidebarPerimetreSection — section périmètres de la sidebar (T815).
 * Gère : liste, filtrage, édition et ajout de périmètres.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { agentFg, agentAccent } from '@renderer/utils/agentColor'
import type { Perimetre } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()
const tabsStore = useTabsStore()

// ── Périmètre editor ─────────────────────────────────────────────────────────
const editPerimetre = ref<Perimetre | null>(null)
const editPerimetreName = ref('')
const editPerimetreDesc = ref('')
const savingPerimetre = ref(false)

/** v-dialog model — opens when editPerimetre is set */
const showEditDialog = computed({
  get: () => editPerimetre.value !== null,
  set: (v: boolean) => { if (!v) editPerimetre.value = null },
})

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

    <!-- MD3 v-list for perimetre items (default slot only — avoids Vue 3.5 named-slot + v-for compiler issue) -->
    <v-list density="compact" bg-color="transparent" class="pa-0">
      <div v-for="p in store.perimetresData" :key="p.id" class="perimetre-item">
        <v-list-item
          density="compact"
          rounded="lg"
          :active="store.selectedPerimetre === p.name"
          active-color="secondary-container"
          @click="store.togglePerimetreFilter(p.name)"
        >
          <div class="perimetre-content">
            <div class="perimetre-row">
              <span class="perimetre-name" :style="{ color: agentAccent(p.name) }">{{ p.name }}</span>
              <div class="perimetre-badges ga-1">
                <!-- MD3 v-chip badges replacing custom .perimetre-badge spans -->
                <v-chip
                  v-if="(agentCountByPerimetre.get(p.name) ?? 0) > 0"
                  size="x-small"
                  variant="tonal"
                  :color="agentFg(p.name)"
                  :title="t('sidebar.nbAgents', agentCountByPerimetre.get(p.name) ?? 0, { named: { n: agentCountByPerimetre.get(p.name) ?? 0 } })"
                >
                  <v-icon size="9" start>mdi-account</v-icon>
                  {{ agentCountByPerimetre.get(p.name) ?? 0 }}
                </v-chip>
                <v-chip
                  v-if="(taskCountByPerimetre.get(p.name) ?? 0) > 0"
                  size="x-small"
                  variant="tonal"
                  :color="agentFg(p.name)"
                  :title="t('sidebar.nbActiveTasks', taskCountByPerimetre.get(p.name) ?? 0, { named: { n: taskCountByPerimetre.get(p.name) ?? 0 } })"
                >
                  <v-icon size="9" start>mdi-format-list-checks</v-icon>
                  {{ taskCountByPerimetre.get(p.name) ?? 0 }}
                </v-chip>
                <!-- Edit button — visible on hover -->
                <v-btn
                  icon
                  variant="text"
                  density="compact"
                  size="x-small"
                  class="edit-btn"
                  :title="t('sidebar.editPerimeter')"
                  @click.stop="openEditPerimetre(p)"
                >
                  <v-icon size="12">mdi-pencil</v-icon>
                </v-btn>
              </div>
            </div>
            <p v-if="p.description" class="perimetre-desc text-label-medium">{{ p.description }}</p>
          </div>
        </v-list-item>
      </div>
    </v-list>

    <div v-if="store.perimetresData.length === 0" class="no-perimeter-msg pa-2 text-body-2">{{ t('sidebar.noPerimeter') }}</div>

    <v-btn variant="text" block size="small" height="36" class="add-btn ga-2 mt-2 text-caption" prepend-icon="mdi-plus" @click="addPerimetre">
      {{ t('sidebar.addPerimeter') }}
    </v-btn>
  </div>

  <!-- Modal édition périmètre — MD3 v-dialog + v-card -->
  <v-dialog v-model="showEditDialog" max-width="384">
    <v-card v-if="editPerimetre">
      <v-card-title class="text-body-2 font-weight-bold">{{ t('sidebar.editPerimeter') }}</v-card-title>
      <v-card-text class="d-flex flex-column ga-3 pt-2">
        <v-text-field
          v-model="editPerimetreName"
          density="compact"
          variant="outlined"
          autofocus
          hide-details="auto"
          :label="t('sidebar.name')"
          :placeholder="t('sidebar.namePlaceholder')"
          @keydown.esc="editPerimetre = null"
        />
        <v-text-field
          v-model="editPerimetreDesc"
          density="compact"
          variant="outlined"
          hide-details="auto"
          :label="t('sidebar.description')"
          :placeholder="t('sidebar.descriptionPlaceholder')"
          @keydown.enter="savePerimetre"
          @keydown.esc="editPerimetre = null"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" size="small" @click="editPerimetre = null">{{ t('common.cancel') }}</v-btn>
        <v-btn color="primary" size="small" :disabled="savingPerimetre || !editPerimetreName.trim()" @click="savePerimetre">
          {{ savingPerimetre ? t('common.saving') : t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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
  position: relative;
}
/* Layout inside v-list-item default slot */
.perimetre-content {
  width: 100%;
  min-width: 0;
}
.perimetre-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.perimetre-name {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  font-family: monospace;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.perimetre-badges {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.perimetre-desc {
  color: var(--content-faint);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
/* Edit button — visible on hover only */
.edit-btn {
  opacity: 0;
  transition: opacity var(--md-duration-short3) var(--md-easing-standard);
}
.perimetre-item:hover .edit-btn { opacity: 1; }
.no-perimeter-msg {
  color: var(--content-faint);
}
.add-btn {
  color: var(--content-faint) !important;
  justify-content: flex-start !important;
}
</style>
