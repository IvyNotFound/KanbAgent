<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  keymap,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'

const { t } = useI18n()
const props = defineProps<{ filePath: string; tabId: string }>()
const tabsStore = useTabsStore()
const tasksStore = useTasksStore()
const settingsStore = useSettingsStore()

const editorEl = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

const originalContent = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const saveError = ref<string | null>(null)
const saved = ref(false)
const isDirty = ref(false)

const TEXT_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml',
  'md', 'txt', 'csv',
  'css', 'scss', 'less', 'html', 'htm',
  'py', 'rb', 'go', 'rs', 'sh', 'bash', 'zsh',
  'sql', 'prisma', 'env', 'gitignore', 'lock',
])

function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTS.has(ext)
}

async function getLangExtension(path: string): Promise<Extension | null> {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts': case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ typescript: true, jsx: ext === 'tsx' })
    }
    case 'js': case 'jsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: ext === 'jsx' })
    }
    case 'vue': case 'html': case 'htm': {
      const { html } = await import('@codemirror/lang-html')
      return html()
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json')
      return json()
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql')
      return sql()
    }
    case 'css': case 'scss': case 'less': {
      const { css } = await import('@codemirror/lang-css')
      return css()
    }
    case 'md': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    default: return null
  }
}

async function save(): Promise<void> {
  saveError.value = null
  saving.value = true
  try {
    const currentContent = view?.state.doc.toString() ?? ''
    const result = await window.electronAPI.fsWriteFile(props.filePath, currentContent, tasksStore.projectPath)
    if (result.success) {
      originalContent.value = currentContent
      isDirty.value = false
      tabsStore.setTabDirty(props.tabId, false)
      saved.value = true
      setTimeout(() => { saved.value = false }, 2000)
    } else {
      saveError.value = result.error ?? 'Erreur d\'enregistrement'
    }
  } finally {
    saving.value = false
  }
}

async function buildExtensions(): Promise<Extension[]> {
  const langExt = await getLangExtension(props.filePath)
  const exts: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    ...(settingsStore.theme === 'dark' ? [oneDark] : []),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
      { key: 'Mod-s', run: () => { save(); return true } },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const dirty = update.state.doc.toString() !== originalContent.value
        isDirty.value = dirty
        tabsStore.setTabDirty(props.tabId, dirty)
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace', fontSize: '12px' },
      '.cm-content': { padding: '12px 0' },
    }),
  ]
  if (langExt) exts.push(langExt)
  return exts
}

async function initEditor(): Promise<void> {
  if (!editorEl.value) return
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: await buildExtensions() }),
    parent: editorEl.value,
  })
}

async function load(): Promise<void> {
  error.value = null
  saveError.value = null
  saved.value = false
  isDirty.value = false
  if (!isTextFile(props.filePath)) {
    error.value = t('fileView.binaryFile')
    return
  }
  loading.value = true
  try {
    const result = await window.electronAPI.fsReadFile(props.filePath, tasksStore.projectPath)
    if (result.success) {
      originalContent.value = result.content ?? ''
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: originalContent.value }
      })
    } else {
      error.value = result.error ?? 'Erreur de lecture'
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  initEditor()
  await load()
})

onUnmounted(() => {
  view?.destroy()
  view = null
})

// Rebuild editor when theme changes to swap CodeMirror dark/light
watch(() => settingsStore.theme, async () => {
  if (!view || !editorEl.value) return
  const content = view.state.doc.toString()
  view.destroy()
  view = new EditorView({
    state: EditorState.create({ doc: content, extensions: await buildExtensions() }),
    parent: editorEl.value,
  })
})

watch(() => props.filePath, async () => {
  // Recreate editor with new language extension
  view?.destroy()
  view = null
  if (editorEl.value) editorEl.value.innerHTML = ''
  await initEditor()
  await load()
})
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden bg-surface-primary">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-edge-subtle shrink-0 min-h-[41px]">
      <span class="text-xs font-mono text-content-tertiary truncate">{{ filePath.split(/[/\\]/).pop() }}</span>
      <span v-if="isDirty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" :title="t('fileView.unsaved')" />
      <span class="ml-auto flex items-center gap-2 shrink-0">
        <span v-if="saved" class="text-xs text-emerald-400">{{ t('fileView.saved') }}</span>
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <button
          v-if="!error && !loading"
          class="px-2.5 py-1 text-xs rounded bg-surface-tertiary hover:bg-content-faint text-content-secondary transition-colors disabled:opacity-40"
          :disabled="saving || !isDirty"
          @click="save"
        >{{ saving ? t('common.saving') : t('common.save') }}</button>
      </span>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10 bg-surface-primary/80">
        <span class="text-xs text-content-faint animate-pulse">{{ t('common.loading') }}</span>
      </div>
      <div v-if="error" class="flex items-center justify-center h-full px-8">
        <span class="text-xs text-content-subtle italic text-center">{{ error }}</span>
      </div>
      <div v-show="!error" ref="editorEl" class="h-full" />
    </div>
  </div>
</template>

<style>
/* Override One Dark background to match app palette */
.cm-editor {
  height: 100%;
  background-color: var(--surface-primary) !important;
}
.cm-editor .cm-gutters {
  background-color: var(--surface-primary) !important;
  border-right-color: var(--surface-secondary) !important;
}
.cm-editor.cm-focused {
  outline: none !important;
}
</style>
