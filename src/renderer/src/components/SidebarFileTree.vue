<script setup lang="ts">
/**
 * SidebarFileTree — arborescence de fichiers du projet dans la sidebar (T815/T1710).
 * Utilise v-treeview (Vuetify MD3) avec lazy loading natif via load-children.
 * Remplace l'ancienne approche flattenTree() + paddingLeft manuel.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import type { FileNode } from '@renderer/types'

const props = defineProps<{
  projectPath: string | null
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()

// Cast helper — v-treeview slots type item as unknown
function asFile(item: unknown): FileNode { return item as FileNode }

// Helper matching SidebarAgentSection pattern — calls the onToggleExpand handler array or fn
function callToggle(handler: unknown, e: MouseEvent): void {
  e.stopPropagation()
  const h = handler as ((ev: MouseEvent) => void) | ((ev: MouseEvent) => void)[] | undefined
  if (Array.isArray(h)) { h.forEach(fn => fn(e)) } else { h?.(e) }
}

const sidebarTree = ref<FileNode[]>([])
const loadingSidebarTree = ref(false)

// Tracks which dir paths have already been fetched — prevents re-fetch on re-expand
const loadedDirs = new Set<string>()

/** Prepare top-level or child nodes: dirs get children: [] to signal v-treeview expandability */
function prepareNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map(node =>
    node.isDir ? { ...node, children: node.children ?? [] } : node
  )
}

async function loadSidebarTree(): Promise<void> {
  if (!props.projectPath) return
  loadingSidebarTree.value = true
  sidebarTree.value = []
  loadedDirs.clear()
  try {
    const nodes = (await window.electronAPI.fsListDir(props.projectPath, props.projectPath)) as FileNode[]
    sidebarTree.value = prepareNodes(nodes)
  } finally {
    loadingSidebarTree.value = false
  }
}

/**
 * loadChildren — appelé par v-treeview quand children.length === 0 (premier expand d'un dossier).
 * Mute node.children avec les enfants fetched via IPC. loadedDirs évite le double-fetch.
 */
async function loadChildren(node: unknown): Promise<void> {
  const fileNode = node as FileNode
  if (!props.projectPath || loadedDirs.has(fileNode.path)) return
  loadedDirs.add(fileNode.path)
  const children = (await window.electronAPI.fsListDir(fileNode.path, props.projectPath)) as FileNode[]
  fileNode.children = prepareNodes(children)
}

onMounted(() => loadSidebarTree())

defineExpose({ loadSidebarTree, loadChildren, sidebarTree })
</script>

<template>
  <div class="file-tree-content">
    <v-progress-linear v-if="loadingSidebarTree" indeterminate color="primary" />
    <div v-else-if="!projectPath" class="empty-state text-body-2">
      {{ t('common.noProject') }}
    </div>
    <div v-else-if="sidebarTree.length === 0" class="empty-state text-body-2">
      {{ t('sidebar.emptyFolder') }}
    </div>
    <!-- v-treeview MD3 — remplace flattenTree() + v-list + paddingLeft manuel (T1710) -->
    <v-treeview
      v-else
      :items="sidebarTree"
      item-value="path"
      item-children="children"
      :load-children="loadChildren"
      open-strategy="multiple"
      density="compact"
      bg-color="transparent"
      class="pa-0"
    >
      <!-- Dossier — icône folder-open/folder selon état, click toggle via onToggleExpand -->
      <template #header="{ props: itemProps, item, loading }">
        <v-list-item
          :title="undefined"
          density="compact"
          rounded="lg"
          class="dir-item"
          @click="callToggle(itemProps.onToggleExpand, $event)"
        >
          <div class="tree-row">
            <v-icon
              size="14"
              :class="itemProps.ariaExpanded ? 'tree-icon tree-icon--open' : 'tree-icon tree-icon--closed'"
            >
              {{ itemProps.ariaExpanded ? 'mdi-folder-open' : 'mdi-folder' }}
            </v-icon>
            <span class="tree-name tree-name--dir text-body-2">{{ asFile(item).name }}</span>
            <v-progress-circular v-if="loading" indeterminate :size="10" :width="1" color="primary" />
          </div>
        </v-list-item>
      </template>

      <!-- Fichier feuille — click ouvre l'onglet correspondant -->
      <template #item="{ item }">
        <v-list-item
          density="compact"
          rounded="lg"
          class="file-item"
          @click="tabsStore.openFile(asFile(item).path, asFile(item).name)"
        >
          <div class="tree-row">
            <v-icon class="tree-icon tree-icon--file" size="14">mdi-file-outline</v-icon>
            <span class="tree-name tree-name--file text-body-2">{{ asFile(item).name }}</span>
          </div>
        </v-list-item>
      </template>
    </v-treeview>
  </div>
  <v-divider />
  <div class="d-flex align-center px-4 py-2">
    <v-btn variant="text" size="small" color="primary" prepend-icon="mdi-refresh" @click="loadSidebarTree">{{ t('common.refresh') }}</v-btn>
  </div>
</template>

<style scoped>
.file-tree-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 4px 0;
  min-width: 0;
}
.empty-state {
  padding: 12px 16px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 2px 0;
}
.tree-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.tree-icon--open { color: rgb(var(--v-theme-primary)); }
.tree-icon--closed { color: rgba(var(--v-theme-primary), 0.70); }
.tree-icon--file { color: rgba(var(--v-theme-on-surface), 0.60); }
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--md-duration-short3) var(--md-easing-standard);
}
.tree-name--dir {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-weight: 500;
}
.tree-name--file { color: rgba(var(--v-theme-on-surface), 0.70); }
</style>
