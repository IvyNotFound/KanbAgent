<script setup lang="ts">
/**
 * StreamView — structured display of stream-json CLI messages (ADR-009 Option B).
 *
 * Chat-bubble layout: assistant messages rendered as left-aligned bubbles, user messages
 * as right-aligned bubbles. Tool calls delegated to StreamToolBlock for per-tool structured
 * display (Edit: diff view, Bash: command block, Read/Write/Grep/Glob: metadata, Agent: description).
 * Copy-code button injected into all markdown code blocks via useCopyCode composable.
 * Thinking text previewed live in the status bar (last 120 chars). Collapsible blocks
 * auto-collapse when >15 lines. ANSI sequences stripped before rendering.
 *
 * Used in App.vue for tabs with viewMode === 'stream' (T597).
 */
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { agentFg, agentBg, agentBorder, agentAccent, colorVersion, getOnColor, isDark, hexToRgb } from '@renderer/utils/agentColor'
import { parsePromptContext } from '@renderer/utils/parsePromptContext'
import { useStreamEvents } from '@renderer/composables/useStreamEvents'
import { useCopyCode } from '@renderer/composables/useCopyCode'
import { useStreamIpc } from '@renderer/composables/useStreamIpc'
import HookEventBar from './HookEventBar.vue'
import StreamInputBar from './StreamInputBar.vue'
import PermissionRequestBanner from './PermissionRequestBanner.vue'
import ImagePreviewDialog from './ImagePreviewDialog.vue'
import StreamEventBlock from './StreamEventBlock.vue'
import StreamingIndicator from './StreamingIndicator.vue'
import githubDarkUrl from 'highlight.js/styles/github-dark.css?url'
import githubUrl from 'highlight.js/styles/github.css?url'

// Re-export stream types so existing consumers keep their import paths (T816).
export type { StreamContentBlock, StreamEvent } from '@renderer/types/stream'

const props = defineProps<{
  /** Tab identifier — used to look up tab config in tabsStore. */
  terminalId: string
}>()

const tabsStore = useTabsStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// Dynamic highlight.js theme — switches between github.css (light) and github-dark.css (T895)
function applyHljsTheme(theme: string): void {
  const id = 'hljs-theme'
  let link = document.getElementById(id) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = theme === 'dark' ? githubDarkUrl : githubUrl
}
watch(() => settingsStore.theme, applyHljsTheme, { immediate: true })

const {
  events, collapsed, scrollContainer, pendingQuestion,
  assignEventId, enqueueEvent,
  scrollToBottom, toggleCollapsed, cleanup,
} = useStreamEvents(props.terminalId)
useCopyCode(scrollContainer)

// Scroll to bottom when this tab is activated (T1797)
watch(
  () => tabsStore.activeTabId,
  async (newId) => {
    if (newId === props.terminalId) {
      await nextTick()
      scrollToBottom(true)
    }
  }
)

const previewImageSrc = ref<string | null>(null)

// ── Computed ──────────────────────────────────────────────────────────────────

const isStreaming = computed(() => {
  if (events.value.length === 0) return false
  const last = events.value[events.value.length - 1]
  return last.type === 'assistant' || last.type === 'text'
})

const activeThinkingText = computed<string | null>(() => {
  if (!isStreaming.value) return null
  const tab = tabsStore.tabs.find(t => t.id === props.terminalId)
  if (!tab?.thinkingMode) return null
  const blocks = events.value[events.value.length - 1]?.message?.content ?? []
  const last = blocks[blocks.length - 1]
  return last?.type === 'thinking' && last.text ? last.text : null
})

const agentName = computed(() => tabsStore.tabs.find(t => t.id === props.terminalId)?.agentName ?? '')

// Consolidated agent color computed — single colorVersion read, all values derived once (T1864).
const agentColors = computed(() => {
  void colorVersion.value
  const name = agentName.value
  const s = 'rgb(var(--v-theme-secondary))'
  if (!name) {
    return {
      fg: s, bg: 'rgba(var(--v-theme-secondary), 0.1)', border: 'rgba(var(--v-theme-secondary), 0.3)',
      barColor: s, bubbleTextColor: isDark() ? '#FFFFFF' : '#1C1B1F', onColor: isDark() ? '#FFFFFF' : '#1C1B1F', text: s,
    }
  }
  const fg = agentFg(name)
  const bg = agentBg(name)
  const border = agentBorder(name)
  const rgb = hexToRgb(bg)
  const barColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.70)` : bg
  const bubbleTextColor = getOnColor(fg)
  const onColor = bg.startsWith('#') ? getOnColor(bg) : isDark() ? '#FFFFFF' : '#1C1B1F'
  const text = agentAccent(name)
  return { fg, bg, border, barColor, bubbleTextColor, onColor, text }
})

// Suppresses empty user bubbles from autonomous Claude reasoning (T679).
// Also shows user events that contain image_ref blocks (T1718).
const displayEvents = computed(() =>
  events.value.filter(event => {
    if (event.type !== 'user') return true
    if (!event.message) return false
    const hasText = event.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim().length > 0
    const hasImages = event.message.content.some(b => b.type === 'image_ref')
    return hasText || hasImages
  })
)

// Only show first system:init per session — subsequent inits (same session_id) are silent (T1458).
const visibleInitIds = computed(() => {
  const ids = new Set<number>()
  let lastSessionId: string | undefined
  for (const event of events.value) {
    if (event.type === 'system' && event.subtype === 'init') {
      if (event.session_id !== lastSessionId) {
        if (event._id != null) ids.add(event._id)
        lastSessionId = event.session_id ?? undefined
      }
    }
  }
  return ids
})

const sessionContextMap = computed(() => {
  const map = new Map<number, string>()
  let lastInitId: number | null = null
  for (const event of displayEvents.value) {
    if (event.type === 'system' && event.subtype === 'init' && event._id != null) {
      lastInitId = event._id
    } else if (event.type === 'user' && event.message && lastInitId != null) {
      const text = event.message.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
      const { context } = parsePromptContext(text)
      if (context) map.set(lastInitId, context)
      lastInitId = null
    }
  }
  return map
})

// ── IPC lifecycle (delegated to useStreamIpc) ─────────────────────────────────

const {
  sessionId, ptyId, agentStopped, prefillAnswer, pendingPermissions,
  handleStop, handleSend, handlePermissionRespond, handleSelectOption,
} = useStreamIpc({
  terminalId: props.terminalId,
  events,
  enqueueEvent,
  assignEventId,
  scrollToBottom,
  scrollContainer,
  isStreaming,
})

// Cleanup useStreamEvents on unmount (IPC cleanup handled by useStreamIpc)
onUnmounted(() => cleanup())
</script>

<template>
  <div class="stream-view">
    <!-- Agent color accent header bar (T680) -->
    <div v-if="agentName" class="stream-accent-bar" :style="{ background: agentColors.barColor }" />

    <!-- Messages scroll area -->
    <div ref="scrollContainer" class="stream-scroll pa-4 ga-3" :style="{ '--stream-accent-fg': agentColors.text }">
      <div
        v-if="displayEvents.length === 0 && !isStreaming"
        class="stream-empty text-caption"
        data-testid="empty-state"
      >
        {{ t('stream.waitingMessages') }}
      </div>

      <StreamEventBlock
        v-for="event in displayEvents"
        :key="event._id"
        :event="event"
        :collapsed="collapsed"
        :agent-colors="agentColors"
        :is-init-visible="event.type === 'system' && event.subtype === 'init' ? visibleInitIds.has(event._id!) : false"
        :init-context="event._id != null ? sessionContextMap.get(event._id) : undefined"
        @toggle-collapsed="toggleCollapsed"
        @select-option="handleSelectOption"
        @preview-image="previewImageSrc = $event"
      />

      <StreamingIndicator
        v-if="isStreaming"
        :active-thinking-text="activeThinkingText"
        :accent-color="agentColors.text"
      />
    </div>

    <!-- Hook events bar (T742) -->
    <HookEventBar :session-id="sessionId" />

    <!-- T1817: Permission request banner — shown when CLI awaits user approval -->
    <PermissionRequestBanner
      v-for="perm in pendingPermissions"
      :key="perm.permission_id"
      :permission="perm"
      :accent-fg="agentColors.fg"
      :accent-text="agentColors.text"
      @respond="handlePermissionRespond"
    />

    <!-- Input bar — delegated to StreamInputBar (T816) -->
    <StreamInputBar
      :is-streaming="isStreaming"
      :pty-id="ptyId"
      :agent-stopped="agentStopped"
      :session-id="sessionId"
      :accent-fg="agentColors.fg"
      :accent-text="agentColors.text"
      :accent-on-fg="agentColors.bubbleTextColor"
      :pending-question="pendingQuestion ?? undefined"
      :prefill-answer="prefillAnswer"
      @send="handleSend"
      @stop="handleStop"
    />

    <!-- T1894: image lightbox -->
    <ImagePreviewDialog
      :model-value="!!previewImageSrc"
      :src="previewImageSrc"
      @update:model-value="previewImageSrc = null"
    />
  </div>
</template>

<style scoped>
.stream-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface-base);
  color: var(--content-primary);
}

.stream-accent-bar {
  height: 2px;
  width: 100%;
  flex-shrink: 0;
}

.stream-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.stream-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--content-subtle);
}
</style>
