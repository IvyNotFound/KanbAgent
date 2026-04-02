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
        <span class="ex-tree-label">{{ t('explorer.files') }}</span>
        <button class="ex-tree-refresh" :title="t('common.refresh')" @click="loadTree">
          <v-icon size="14">mdi-refresh</v-icon>
        </button>
      </div>
      <div v-if="loadingTree" class="ex-state-center">
        <span class="ex-loading">{{ t('explorer.loading') }}</span>
      </div>
      <div v-else-if="!store.projectPath" class="ex-state-center ex-padded">
        <span class="ex-faint ex-center">{{ t('common.noProject') }}</span>
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
        <span v-else class="ex-faint">{{ t('explorer.selectFile') }}</span>
        <span v-if="fileContent" class="ex-line-count">{{ lineCount(fileContent) }} {{ t('explorer.lines') }}</span>
      </div>
      <div class="ex-content-body">
        <div v-if="loadingFile" class="ex-state-center">
          <span class="ex-loading">{{ t('explorer.reading') }}</span>
        </div>
        <div v-else-if="fileError" class="ex-state-center ex-padded">
          <span class="ex-subtle ex-center ex-italic">{{ fileError }}</span>
        </div>
        <pre v-else-if="fileContent" class="ex-pre">{{ fileContent }}</pre>
        <div v-else class="ex-state-center">
          <span class="ex-dim">—</span>
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
}
.ex-tree-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--content-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ex-tree-refresh {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--content-subtle);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.ex-tree-refresh:hover { color: var(--content-tertiary); background: var(--surface-secondary); }
.ex-tree-nodes { flex: 1; padding: 2px 0; user-select: none; }

.ex-state-center { flex: 1; display: flex; align-items: center; justify-content: center; }
.ex-padded { padding: 16px; }
.ex-loading { font-size: 12px; color: var(--content-faint); animation: exPulse 1.5s ease-in-out infinite; }
@keyframes exPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.ex-faint { font-size: 12px; color: var(--content-faint); }
.ex-subtle { font-size: 12px; color: var(--content-subtle); }
.ex-dim { font-size: 12px; color: var(--content-dim); }
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
  padding: 10px 16px;
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
.ex-line-count { margin-left: auto; font-size: 12px; color: var(--content-faint); flex-shrink: 0; }
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
import { defineComponent, h } from 'vue'

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

// SVG icon factories (VS Code style, inline)
function chevronSvg(open: boolean) {
  return h('svg', {
    viewBox: '0 0 16 16', fill: 'currentColor',
    class: ['w-3 h-3 shrink-0 transition-transform duration-150', open ? 'rotate-90' : ''],
    style: { color: 'var(--content-subtle)' },
  }, [
    h('path', { d: 'M6 4l4 4-4 4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

function folderSvg(open: boolean) {
  return open
    ? h('svg', { viewBox: '0 0 16 16', fill: 'currentColor', class: 'w-4 h-4 shrink-0', style: { color: '#dcb67a' } }, [
        h('path', { d: 'M1.75 3A1.75 1.75 0 0 0 0 4.75v7.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-6.5A1.75 1.75 0 0 0 14.25 4H8.22a.25.25 0 0 1-.177-.073L6.957 2.841A1.75 1.75 0 0 0 5.721 2.25H1.75zM1.5 4.75a.25.25 0 0 1 .25-.25h3.971c.067 0 .13.026.177.073l1.086 1.086A1.75 1.75 0 0 0 8.22 5.5h6.03a.25.25 0 0 1 .25.25v6.5a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25z' }),
      ])
    : h('svg', { viewBox: '0 0 16 16', fill: 'currentColor', class: 'w-4 h-4 shrink-0', style: { color: '#c09553' } }, [
        h('path', { d: 'M1.75 3A1.75 1.75 0 0 0 0 4.75v7.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-6.5A1.75 1.75 0 0 0 14.25 4H8.22a.25.25 0 0 1-.177-.073L6.957 2.841A1.75 1.75 0 0 0 5.721 2.25H1.75zM1.5 4.75a.25.25 0 0 1 .25-.25h3.971c.067 0 .13.026.177.073l1.086 1.086A1.75 1.75 0 0 0 8.22 5.5h6.03a.25.25 0 0 1 .25.25v6.5a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25z' }),
      ])
}

function fileSvg(name: string) {
  return h('svg', { viewBox: '0 0 16 16', fill: 'currentColor', class: 'w-4 h-4 shrink-0', style: { color: fileIconColor(name) } }, [
    h('path', { d: 'M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5.414a.25.25 0 0 0-.073-.177L9.263 2.073a.25.25 0 0 0-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.164 3.163c.329.328.513.773.513 1.237v8.337A1.75 1.75 0 0 1 12.5 15h-9A1.75 1.75 0 0 1 2 13.25z' }),
  ])
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
        node.isDir ? chevronSvg(isOpen) : h('span', { class: 'w-3 shrink-0' }),
        // Icon
        node.isDir ? folderSvg(isOpen) : fileSvg(node.name),
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
