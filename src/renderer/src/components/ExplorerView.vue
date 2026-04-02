<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import type { FileNode } from '@renderer/types'

const { t } = useI18n()
const store = useTasksStore()

const tree = ref<FileNode[]>([])
const openDirs = ref<Set<string>>(new Set())
const selectedPath = ref<string | null>(null)
const fileContent = ref<string>('')
const loadingFile = ref(false)
const loadingTree = ref(false)
const fileError = ref<string | null>(null)

const selectedName = computed(() =>
  selectedPath.value ? selectedPath.value.split(/[/\\]/).pop() ?? '' : ''
)

const isTextFile = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ['ts', 'js', 'vue', 'json', 'md', 'txt', 'css', 'html', 'yaml', 'yml',
    'toml', 'sh', 'env', 'py', 'rs', 'go', 'sql', 'prisma', 'gitignore'].includes(ext)
}


async function loadTree(): Promise<void> {
  if (!store.projectPath) return
  loadingTree.value = true
  try {
    tree.value = (await window.electronAPI.fsListDir(store.projectPath, store.projectPath)) as FileNode[]
    // Expand root level dirs by default
    for (const node of tree.value) {
      if (node.isDir) openDirs.value.add(node.path)
    }
  } finally {
    loadingTree.value = false
  }
}

async function selectFile(node: FileNode): Promise<void> {
  if (node.isDir) {
    if (openDirs.value.has(node.path)) openDirs.value.delete(node.path)
    else openDirs.value.add(node.path)
    return
  }
  selectedPath.value = node.path
  fileContent.value = ''
  fileError.value = null
  if (!isTextFile(node.name)) {
    fileError.value = t('explorer.binaryFile')
    return
  }
  loadingFile.value = true
  try {
    const result = await window.electronAPI.fsReadFile(node.path, store.projectPath)
    if (result.success) fileContent.value = result.content ?? ''
    else fileError.value = result.error ?? t('explorer.readError')
  } finally {
    loadingFile.value = false
  }
}

function lineCount(content: string): number {
  return content.split('\n').length
}

onMounted(loadTree)
</script>

<template>
  <div class="ex-view">
    <!-- Tree panel -->
    <div class="ex-tree">
      <div class="ex-tree-header">
        <span class="ex-tree-label text-caption">{{ t('explorer.files') }}</span>
        <v-btn icon variant="text" density="compact" size="small" class="ex-tree-refresh" :title="t('common.refresh')" @click="loadTree">
          <v-icon size="14">mdi-refresh</v-icon>
        </v-btn>
      </div>
      <div v-if="loadingTree" class="ex-state-center">
        <span class="ex-loading text-caption">{{ t('explorer.loading') }}</span>
      </div>
      <div v-else-if="!store.projectPath" class="ex-state-center ex-padded">
        <span class="ex-faint ex-center text-caption">{{ t('common.noProject') }}</span>
      </div>
      <div v-else class="ex-tree-nodes">
        <FileTreeNode
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :open-dirs="openDirs"
          :selected-path="selectedPath"
          :depth="0"
          @select="selectFile"
        />
      </div>
    </div>

    <!-- Content panel -->
    <div class="ex-content">
      <div class="ex-content-header">
        <span v-if="selectedPath" class="ex-content-filename">{{ selectedName }}</span>
        <span v-else class="ex-faint text-caption">{{ t('explorer.selectFile') }}</span>
        <span v-if="fileContent" class="ex-line-count text-caption">{{ lineCount(fileContent) }} {{ t('explorer.lines') }}</span>
      </div>
      <div class="ex-content-body">
        <div v-if="loadingFile" class="ex-state-center">
          <span class="ex-loading text-caption">{{ t('explorer.reading') }}</span>
        </div>
        <div v-else-if="fileError" class="ex-state-center ex-padded">
          <span class="ex-subtle ex-center ex-italic text-caption">{{ fileError }}</span>
        </div>
        <pre v-else-if="fileContent" class="ex-pre">{{ fileContent }}</pre>
        <div v-else class="ex-state-center">
          <span class="ex-dim text-caption">—</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ex-view { flex: 1; display: flex; overflow: hidden; }

.ex-tree {
  width: 256px;
  flex-shrink: 0;
  border-right: 1px solid var(--edge-subtle);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.ex-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.ex-tree-label {
  font-weight: 600;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ex-tree-refresh {
  color: var(--content-subtle) !important;
}
.ex-tree-nodes { flex: 1; padding: 4px 0; user-select: none; }

.ex-state-center { flex: 1; display: flex; align-items: center; justify-content: center; }
.ex-padded { padding: 16px; }
.ex-loading {}
@keyframes exPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.ex-faint {}
.ex-subtle {}
.ex-dim {}
.ex-center { text-align: center; }
.ex-italic { font-style: italic; }

.ex-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ex-content-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
  min-height: 41px;
}
.ex-content-filename {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--content-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ex-line-count { margin-left: auto; color: var(--content-faint); flex-shrink: 0; 
}
.ex-content-body { flex: 1; overflow: auto; }
.ex-pre {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--content-tertiary);
  line-height: 1.625;
  padding: 16px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  margin: 0;
}
</style>

<script lang="ts">
// Sub-component: recursive file tree node — VS Code-style rendering
import { defineComponent, h, resolveComponent, type Component } from 'vue'

// File extension → icon color mapping (VS Code inspired)
const EXT_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6',
  js: '#f1e05a', jsx: '#f1e05a',
  vue: '#41b883',
  json: '#cbcb41',
  md: '#519aba', txt: '#519aba',
  css: '#563d7c', scss: '#c6538c', less: '#1d365d',
  html: '#e34c26', htm: '#e34c26',
  py: '#3572a5', rs: '#dea584', go: '#00add8',
  sql: '#e38c00', sh: '#89e051', bash: '#89e051',
  yaml: '#cb171e', yml: '#cb171e', toml: '#9c4221',
}

function fileIconColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? '#9ca3af'
}

// MDI icon factories (VS Code style) — VIcon resolved at runtime to avoid static CSS import
function chevronSvg(VIconComp: Component, open: boolean) {
  return h(VIconComp, {
    class: ['shrink-0 transition-transform duration-150', open ? 'rotate-90' : ''],
    size: 12,
    style: { color: 'var(--content-subtle)' },
    icon: 'mdi-chevron-right',
  })
}

function folderSvg(VIconComp: Component, open: boolean) {
  return h(VIconComp, {
    class: 'shrink-0',
    size: 16,
    style: { color: open ? '#dcb67a' : '#c09553' },
    icon: open ? 'mdi-folder-open' : 'mdi-folder',
  })
}

function fileSvg(VIconComp: Component, name: string) {
  return h(VIconComp, {
    class: 'shrink-0',
    size: 16,
    style: { color: fileIconColor(name) },
    icon: 'mdi-file-outline',
  })
}

const FileTreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    node: { type: Object as () => FileNode, required: true },
    openDirs: { type: Object as () => Set<string>, required: true },
    selectedPath: { type: String as () => string | null, default: null },
    depth: { type: Number, default: 0 },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const VIconComp = resolveComponent('VIcon') as Component
    return () => {
      const node = props.node
      const isOpen = node.isDir && props.openDirs.has(node.path)
      const isSelected = props.selectedPath === node.path
      const indent = props.depth * 16

      // Build indentation guides (thin vertical lines like VS Code)
      const guides: ReturnType<typeof h>[] = []
      for (let i = 0; i < props.depth; i++) {
        guides.push(h('span', {
          class: 'absolute top-0 bottom-0 w-px',
          style: { left: `${12 + i * 16}px`, backgroundColor: 'var(--edge-subtle)' },
        }))
      }

      const label = h('button', {
        class: [
          'w-full relative flex items-center gap-1.5 h-[22px] text-left text-[13px] leading-[22px] transition-colors',
          isSelected
            ? 'bg-surface-tertiary text-content-primary'
            : 'text-content-secondary hover:bg-surface-secondary/70',
        ],
        style: { paddingLeft: `${8 + indent}px` },
        onClick: () => emit('select', node),
      }, [
        ...guides,
        // Chevron (dirs only)
        node.isDir ? chevronSvg(VIconComp, isOpen) : h('span', { class: 'w-3 shrink-0' }),
        // Icon
        node.isDir ? folderSvg(VIconComp, isOpen) : fileSvg(VIconComp, node.name),
        // Label
        h('span', { class: 'truncate' }, node.name),
      ])

      const children = isOpen && node.children?.length
        ? node.children.map(child =>
            h(FileTreeNode, {
              key: child.path,
              node: child,
              openDirs: props.openDirs,
              selectedPath: props.selectedPath,
              depth: props.depth + 1,
              onSelect: (n: FileNode) => emit('select', n),
            })
          )
        : []

      return h('div', [label, ...children])
    }
  },
})

export { FileTreeNode }
</script>
