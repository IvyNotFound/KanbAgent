<script setup lang="ts">
/**
 * SidebarFileTree — arborescence de fichiers du projet dans la sidebar (T815).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import type { FileNode } from '@renderer/types'

const props = defineProps<{
  projectPath: string | null
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()

const sidebarTree = ref<FileNode[]>([])
const sidebarOpenDirs = ref(new Set<string>())
const loadingSidebarTree = ref(false)
const loadingDirs = ref(new Set<string>())

async function loadSidebarTree(): Promise<void> {
  if (!props.projectPath) return
  loadingSidebarTree.value = true
  sidebarTree.value = []
  sidebarOpenDirs.value = new Set()
  try {
    const nodes = (await window.electronAPI.fsListDir(props.projectPath, props.projectPath)) as FileNode[]
    sidebarTree.value = nodes
  } finally {
    loadingSidebarTree.value = false
  }
}

async function toggleSidebarDir(path: string, node: FileNode): Promise<void> {
  if (loadingDirs.value.has(path)) return
  const next = new Set(sidebarOpenDirs.value)
  if (next.has(path)) {
    next.delete(path)
    sidebarOpenDirs.value = next
  } else {
    if (node.children === undefined && props.projectPath) {
      const loading = new Set(loadingDirs.value)
      loading.add(path)
      loadingDirs.value = loading
      try {
        const children = await window.electronAPI.fsListDir(node.path, props.projectPath)
        node.children = children as FileNode[]
      } finally {
        const loading2 = new Set(loadingDirs.value)
        loading2.delete(path)
        loadingDirs.value = loading2
      }
    }
    next.add(path)
    sidebarOpenDirs.value = next
  }
}

function isDirOpen(path: string): boolean {
  return sidebarOpenDirs.value.has(path)
}

function flattenTree(
  nodes: FileNode[],
  depth = 0,
  result: Array<{ node: FileNode; depth: number }> = []
): Array<{ node: FileNode; depth: number }> {
  for (const node of nodes) {
    result.push({ node, depth })
    if (node.isDir && isDirOpen(node.path) && node.children?.length) {
      flattenTree(node.children, depth + 1, result)
    }
  }
  return result
}

const flatSidebarTree = computed(() => flattenTree(sidebarTree.value))

onMounted(() => loadSidebarTree())

defineExpose({ loadSidebarTree })
</script>

<template>
  <div class="file-tree-content">
    <div v-if="loadingSidebarTree" class="loading-state">
      <span class="loading-text">{{ t('common.loading') }}</span>
    </div>
    <div v-else-if="!projectPath" class="empty-state">
      {{ t('common.noProject') }}
    </div>
    <div v-else-if="flatSidebarTree.length === 0 && !loadingSidebarTree" class="empty-state">
      {{ t('sidebar.emptyFolder') }}
    </div>
    <button
      v-for="item in flatSidebarTree"
      :key="item.node.path"
      :class="['tree-btn', item.node.isDir ? 'tree-btn--dir' : 'tree-btn--file']"
      :style="{ paddingLeft: `${6 + item.depth * 12}px` }"
      @click="item.node.isDir ? toggleSidebarDir(item.node.path, item.node) : tabsStore.openFile(item.node.path, item.node.name)"
    >
      <!-- Icône dossier ouvert/fermé ou fichier -->
      <v-icon v-if="item.node.isDir && isDirOpen(item.node.path)" class="tree-icon tree-icon--open" size="14">mdi-folder-open</v-icon>
      <v-icon v-else-if="item.node.isDir" class="tree-icon tree-icon--closed" size="14">mdi-folder</v-icon>
      <v-icon v-else class="tree-icon tree-icon--file" size="14">mdi-file-outline</v-icon>
      <!-- Nom -->
      <span :class="['tree-name', item.node.isDir ? 'tree-name--dir' : 'tree-name--file']">{{ item.node.name }}</span>
    </button>
  </div>
  <div class="tree-footer">
    <button class="refresh-btn" @click="loadSidebarTree">↺ {{ t('common.refresh') }}</button>
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
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
}
.loading-text {
  font-size: 0.75rem;
  color: var(--content-faint);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.empty-state {
  padding: 12px 16px;
  font-size: 0.75rem;
  color: var(--content-faint);
}
.tree-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 8px;
  text-align: left;
  font-size: 0.875rem;
  transition: background 150ms;
  border-radius: 4px;
  background: none;
  border: none;
  cursor: pointer;
}
.tree-btn--dir:hover { background: rgba(var(--v-theme-on-surface), 0.05); }
.tree-btn--file:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.tree-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.tree-icon--open { color: #f59e0b; }
.tree-icon--closed { color: rgba(245, 158, 11, 0.7); }
.tree-icon--file { color: var(--content-subtle); }
.tree-btn:hover .tree-icon--file { color: var(--content-muted); }
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}
.tree-name--dir {
  color: var(--content-secondary);
  font-weight: 500;
}
.tree-btn:hover .tree-name--dir { color: var(--content-primary); }
.tree-name--file { color: var(--content-muted); }
.tree-btn:hover .tree-name--file { color: var(--content-secondary); }
.tree-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--edge-subtle);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.refresh-btn {
  font-size: 0.75rem;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 150ms;
}
.refresh-btn:hover { color: var(--content-tertiary); }
</style>
