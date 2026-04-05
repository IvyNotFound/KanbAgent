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

// Holds content fetched before the editor is ready (race condition guard)
let pendingContent: string | null = null

async function initEditor(): Promise<void> {
  if (!editorEl.value) return
  const extensions = await buildExtensions()
  view = new EditorView({
    state: EditorState.create({ doc: pendingContent ?? '', extensions }),
    parent: editorEl.value,
  })
  pendingContent = null
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
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: originalContent.value }
        })
      } else {
        // Editor not ready yet — store content for initEditor to pick up
        pendingContent = originalContent.value
      }
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
  <div class="fv-view">
    <!-- Header -->
    <div class="fv-header">
      <span class="fv-filename">{{ filePath.split(/[/\\]/).pop() }}</span>
      <span v-if="isDirty" class="fv-dirty-dot" :title="t('fileView.unsaved')" />
      <span class="fv-actions">
        <span v-if="saved" class="fv-saved text-caption">{{ t('fileView.saved') }}</span>
        <span v-if="saveError" class="fv-save-error text-caption">{{ saveError }}</span>
        <v-btn
          v-if="!error && !loading"
          variant="tonal"
          size="small"
          class="fv-save-btn text-caption"
          :disabled="saving || !isDirty"
          @click="save"
        >{{ saving ? t('common.saving') : t('common.save') }}</v-btn>
      </span>
    </div>

    <!-- Content -->
    <div class="fv-content">
      <div v-if="loading" class="fv-loading-overlay">
        <span class="fv-loading-text text-caption">{{ t('common.loading') }}</span>
      </div>
      <div v-if="error" class="fv-error-state">
        <span class="fv-error-text text-caption">{{ error }}</span>
      </div>
      <div v-show="!error" ref="editorEl" class="fv-editor" />
    </div>
  </div>
</template>

<style scoped>
.fv-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-primary, var(--surface-base));
}
.fv-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--edge-subtle);
  flex-shrink: 0;
  min-height: 41px;
}
.fv-filename {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--content-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fv-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-warning));
  flex-shrink: 0;
}
.fv-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.fv-saved {}
.fv-save-error {}
.fv-content { flex: 1; overflow: hidden; position: relative; }
.fv-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: rgba(var(--v-theme-surface-primary), 0.8);
}
.fv-loading-text {
  color: var(--content-faint);
  animation: fvPulse 1.5s ease-in-out infinite;
}
@keyframes fvPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.fv-error-state { display: flex; align-items: center; justify-content: center; height: 100%; padding: 0 32px; }
.fv-error-text {}
.fv-editor { height: 100%; }
</style>

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
