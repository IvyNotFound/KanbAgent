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
    if (task.statut !== 'archived' && task.perimetre) {
      map.set(task.perimetre, (map.get(task.perimetre) ?? 0) + 1)
    }
  }
  return map
})

const agentCountByPerimetre = computed(() => {
  const map = new Map<string, number>()
  for (const a of store.agents) {
    if (a.perimetre) {
      map.set(a.perimetre, (map.get(a.perimetre) ?? 0) + 1)
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
    title: 'Ajouter un périmètre',
    message: 'Une session Claude Code va être lancée pour créer le nouveau périmètre.',
    detail: 'L\'agent arch guidera la configuration. Continuer ?',
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
  <div class="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-1">
    <div v-if="store.selectedPerimetre !== null" class="flex justify-end mb-2">
      <button
        class="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        @click="store.selectedPerimetre = null"
      >{{ t('sidebar.reset') }}</button>
    </div>

    <div v-for="p in store.perimetresData" :key="p.id" class="group rounded-md">
      <div class="relative">
        <button
          :class="['w-full text-left px-2 py-2 rounded-md transition-colors pr-8', store.selectedPerimetre === p.name ? 'ring-1 ring-content-faint' : 'hover:bg-surface-primary']"
          :style="store.selectedPerimetre === p.name ? { backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) } : {}"
          @click="store.togglePerimetreFilter(p.name)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-mono truncate font-medium" :style="{ color: agentFg(p.name) }">{{ p.name }}</span>
            <div class="flex items-center gap-1.5 shrink-0">
              <span v-if="(agentCountByPerimetre.get(p.name) ?? 0) > 0" class="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border" :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }" :title="t('sidebar.nbAgents', agentCountByPerimetre.get(p.name) ?? 0, { named: { n: agentCountByPerimetre.get(p.name) ?? 0 } })">
                <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg>
                {{ agentCountByPerimetre.get(p.name) ?? 0 }}
              </span>
              <span v-if="(taskCountByPerimetre.get(p.name) ?? 0) > 0" class="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border" :style="{ color: agentFg(p.name), backgroundColor: agentBg(p.name), borderColor: agentBorder(p.name) }" :title="t('sidebar.nbActiveTasks', taskCountByPerimetre.get(p.name) ?? 0, { named: { n: taskCountByPerimetre.get(p.name) ?? 0 } })">
                <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0"><path d="M2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm3 0a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm0 4a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm0 4a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1h-8zm-3-4a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1zm0 4a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1z"/></svg>
                {{ taskCountByPerimetre.get(p.name) ?? 0 }}
              </span>
            </div>
          </div>
          <p v-if="p.description" class="text-[10px] text-content-faint truncate mt-0.5">{{ p.description }}</p>
        </button>
        <button class="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-content-faint hover:text-content-secondary hover:bg-surface-tertiary transition-colors opacity-0 group-hover:opacity-100" title="Modifier" @click.stop="openEditPerimetre(p)">
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>
        </button>
      </div>
    </div>

    <div v-if="store.perimetresData.length === 0" class="text-sm text-content-faint px-2 py-2">{{ t('sidebar.noPerimeter') }}</div>

    <button class="mt-2 flex items-center gap-2 px-2 py-2 rounded-md text-xs text-content-faint hover:text-content-tertiary hover:bg-surface-primary transition-colors w-full" @click="addPerimetre">
      <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>
      {{ t('sidebar.addPerimeter') }}
    </button>
  </div>

  <!-- Modal édition périmètre -->
  <Teleport to="body">
    <div v-if="editPerimetre" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="editPerimetre = null">
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl p-5 w-96 flex flex-col gap-3">
        <p class="text-sm font-semibold text-content-secondary">{{ t('sidebar.editPerimeter') }}</p>
        <div>
          <label class="text-xs text-content-subtle uppercase tracking-wider font-semibold block mb-1">{{ t('sidebar.name') }}</label>
          <input v-model="editPerimetreName" class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-1.5 text-sm text-content-primary font-mono outline-none focus:ring-1 focus:ring-violet-500" :placeholder="t('sidebar.namePlaceholder')" @keydown.esc="editPerimetre = null" />
        </div>
        <div>
          <label class="text-xs text-content-subtle uppercase tracking-wider font-semibold block mb-1">{{ t('sidebar.description') }}</label>
          <input v-model="editPerimetreDesc" class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-1.5 text-sm text-content-tertiary outline-none focus:ring-1 focus:ring-violet-500" :placeholder="t('sidebar.descriptionPlaceholder')" @keydown.enter="savePerimetre" @keydown.esc="editPerimetre = null" />
        </div>
        <div class="flex gap-2 justify-end">
          <button class="px-3 py-1.5 text-xs rounded-md text-content-muted hover:text-content-secondary hover:bg-surface-secondary transition-colors" @click="editPerimetre = null">{{ t('common.cancel') }}</button>
          <button class="px-3 py-1.5 text-xs rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40" :disabled="savingPerimetre || !editPerimetreName.trim()" @click="savePerimetre">{{ savingPerimetre ? t('common.saving') : t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
