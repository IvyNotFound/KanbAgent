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
  <!-- MD3 v-list for file tree items (default slot only — avoids Vue 3.5 named-slot + v-for compiler issue) -->
  <div class="file-tree-content">
    <div v-if="loadingSidebarTree" class="loading-state">
      <span class="loading-text text-caption">{{ t('common.loading') }}</span>
    </div>
    <div v-else-if="!projectPath" class="empty-state text-caption">
      {{ t('common.noProject') }}
    </div>
    <div v-else-if="flatSidebarTree.length === 0 && !loadingSidebarTree" class="empty-state text-caption">
      {{ t('sidebar.emptyFolder') }}
    </div>
    <v-list v-else density="compact" bg-color="transparent" class="pa-0">
      <!-- Tree items — indentation via paddingLeft, icons + name in default slot -->
      <v-list-item
        v-for="item in flatSidebarTree"
        :key="item.node.path"
        density="compact"
        :class="[item.node.isDir ? 'tree-item--dir' : 'tree-item--file']"
        :style="{ paddingLeft: `${6 + item.depth * 12}px` }"
        @click="item.node.isDir ? toggleSidebarDir(item.node.path, item.node) : tabsStore.openFile(item.node.path, item.node.name)"
      >
        <div class="tree-row">
          <!-- Icône dossier ouvert/fermé ou fichier — single element avoids slot fragment issue -->
          <v-icon
            :class="['tree-icon', item.node.isDir && isDirOpen(item.node.path) ? 'tree-icon--open' : item.node.isDir ? 'tree-icon--closed' : 'tree-icon--file']"
            size="14"
          >
            {{ item.node.isDir && isDirOpen(item.node.path) ? 'mdi-folder-open' : item.node.isDir ? 'mdi-folder' : 'mdi-file-outline' }}
          </v-icon>
          <span :class="['tree-name', item.node.isDir ? 'tree-name--dir' : 'tree-name--file']">{{ item.node.name }}</span>
        </div>
      </v-list-item>
    </v-list>
  </div>
  <div class="tree-footer">
    <v-btn variant="text" size="small" class="refresh-btn text-caption" @click="loadSidebarTree">↺ {{ t('common.refresh') }}</v-btn>
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
  color: var(--content-faint);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.empty-state {
  padding: 12px 16px;
  color: var(--content-faint);
}
/* Tree item row layout */
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
}
.tree-icon--open { color: rgb(var(--v-theme-warning)); }
.tree-icon--closed { color: rgba(var(--v-theme-warning), 0.7); }
.tree-icon--file { color: var(--content-subtle); }
.tree-item--file:hover .tree-icon--file { color: var(--content-muted); }
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
.tree-item--dir:hover .tree-name--dir { color: var(--content-primary); }
.tree-name--file { color: var(--content-muted); }
.tree-item--file:hover .tree-name--file { color: var(--content-secondary); }
.tree-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--edge-subtle);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.refresh-btn {
  color: var(--content-subtle) !important;
}
</style>
