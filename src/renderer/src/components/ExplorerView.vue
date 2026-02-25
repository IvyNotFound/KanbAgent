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
  <div class="flex-1 flex overflow-hidden">
    <!-- Tree panel -->
    <div class="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto flex flex-col">
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
        <span class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{{ t('explorer.files') }}</span>
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          :title="t('common.refresh')"
          @click="loadTree"
        >↺</button>
      </div>
      <div v-if="loadingTree" class="flex-1 flex items-center justify-center">
        <span class="text-xs text-zinc-600 animate-pulse">{{ t('explorer.loading') }}</span>
      </div>
      <div v-else-if="!store.projectPath" class="flex-1 flex items-center justify-center px-4">
        <span class="text-xs text-zinc-600 text-center">{{ t('common.noProject') }}</span>
      </div>
      <div v-else class="flex-1 py-1">
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
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 shrink-0 min-h-[41px]">
        <span v-if="selectedPath" class="text-xs font-mono text-zinc-300 truncate">{{ selectedName }}</span>
        <span v-else class="text-xs text-zinc-600">{{ t('explorer.selectFile') }}</span>
        <span v-if="fileContent" class="ml-auto text-xs text-zinc-600 shrink-0">
          {{ lineCount(fileContent) }} {{ t('explorer.lines') }}
        </span>
      </div>
      <div class="flex-1 overflow-auto">
        <div v-if="loadingFile" class="flex items-center justify-center h-full">
          <span class="text-xs text-zinc-600 animate-pulse">{{ t('explorer.reading') }}</span>
        </div>
        <div v-else-if="fileError" class="flex items-center justify-center h-full px-8">
          <span class="text-xs text-zinc-500 italic text-center">{{ fileError }}</span>
        </div>
        <pre
          v-else-if="fileContent"
          class="text-xs font-mono text-zinc-300 leading-relaxed p-4 whitespace-pre-wrap break-words"
        >{{ fileContent }}</pre>
        <div v-else class="flex items-center justify-center h-full">
          <span class="text-xs text-zinc-700">—</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// Sub-component: recursive file tree node (defined inline to avoid separate file)
import { defineComponent, h } from 'vue'

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

      const indent = props.depth * 12

      // Icône selon le type
      const icon = node.isDir
        ? (isOpen ? '▾' : '▸')
        : getFileIcon(node.name)

      // Couleur selon le type
      const labelColor = node.isDir
        ? 'text-amber-400'
        : getFileColor(node.name)
      const label = h('button', {
        class: [
          'w-full flex items-center gap-1.5 px-2 py-0.5 text-left text-xs transition-colors rounded',
          isSelected
            ? 'bg-violet-500/20 text-violet-300'
            : node.isDir
              ? 'text-zinc-300 hover:bg-zinc-800'
              : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        ],
        style: { paddingLeft: `${8 + indent}px` },
        onClick: () => emit('select', node),
      }, [
        node.isDir
          ? h('span', { class: 'text-zinc-500 text-[10px] w-3 shrink-0 text-center' }, icon)
          : h('span', { class: 'w-3 shrink-0' }),
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
