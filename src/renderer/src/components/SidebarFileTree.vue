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
  <div class="flex-1 overflow-y-auto min-h-0 py-1 min-w-0">
    <div v-if="loadingSidebarTree" class="flex items-center justify-center py-6">
      <span class="text-xs text-content-faint animate-pulse">{{ t('common.loading') }}</span>
    </div>
    <div v-else-if="!projectPath" class="px-4 py-3 text-xs text-content-faint">
      {{ t('common.noProject') }}
    </div>
    <div v-else-if="flatSidebarTree.length === 0 && !loadingSidebarTree" class="px-4 py-3 text-xs text-content-faint">
      {{ t('sidebar.emptyFolder') }}
    </div>
    <button
      v-for="item in flatSidebarTree"
      :key="item.node.path"
      class="w-full flex items-center gap-2 py-1 text-left text-sm transition-colors rounded pr-2 group"
      :class="item.node.isDir ? 'hover:bg-surface-secondary/70' : 'hover:bg-surface-secondary/50'"
      :style="{ paddingLeft: `${6 + item.depth * 12}px` }"
      @click="item.node.isDir ? toggleSidebarDir(item.node.path, item.node) : tabsStore.openFile(item.node.path, item.node.name)"
    >
      <!-- Icône dossier ouvert/fermé ou fichier -->
      <svg v-if="item.node.isDir && isDirOpen(item.node.path)" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-amber-400">
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6a1 1 0 0 1 .8.4L7.5 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5z"/>
      </svg>
      <svg v-else-if="item.node.isDir" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-amber-500/70">
        <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a2 2 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.98 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
      </svg>
      <svg v-else viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 shrink-0 text-content-subtle group-hover:text-content-muted">
        <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z"/>
      </svg>
      <!-- Nom -->
      <span
        class="truncate font-mono"
        :class="item.node.isDir
          ? 'text-content-secondary font-medium group-hover:text-content-primary'
          : 'text-content-muted group-hover:text-content-secondary'"
      >{{ item.node.name }}</span>
    </button>
  </div>
  <div class="px-4 py-2 border-t border-edge-subtle shrink-0 flex items-center justify-between">
    <button
      class="text-xs text-content-subtle hover:text-content-tertiary transition-colors"
      @click="loadSidebarTree"
    >↺ {{ t('common.refresh') }}</button>
  </div>
</template>
