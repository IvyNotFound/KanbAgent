<script setup lang="ts">
/**
 * StreamView — POC affichage structuré de messages CLI stream-json (ADR-009 Option B).
 *
 * Remplace xterm.js pour les sessions agents Claude en affichant les blocs
 * de messages de façon structurée (texte, tool_use, tool_result, thinking, result).
 *
 * Câblé dans App.vue pour les tabs dont viewMode === 'stream' (T597).
 *
 * @module components/StreamView
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'

// ── Types stream-json (ADR-009 §Types de messages JSONL) ─────────────────────

export interface StreamContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  /** text block */
  text?: string
  /** tool_use block */
  name?: string
  input?: Record<string, unknown>
  /** tool_result block */
  content?: string | Array<{ type: string; text?: string }>
  tool_use_id?: string
  is_error?: boolean
}

export interface StreamEvent {
  type: 'system' | 'user' | 'assistant' | 'result'
  subtype?: string
  session_id?: string
  message?: {
    role: string
    content: StreamContentBlock[]
  }
  cost_usd?: number
  num_turns?: number
  duration_ms?: number
}

// ── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Terminal / stream identifier passed to IPC. */
  terminalId: string
}>()

// ── Stores ───────────────────────────────────────────────────────────────────

const tabsStore = useTabsStore()
const tasksStore = useTasksStore()

// ── State ────────────────────────────────────────────────────────────────────

const events = ref<StreamEvent[]>([])
const inputText = ref('')
const scrollContainer = ref<HTMLElement | null>(null)
const sessionId = ref<string | null>(null)
/** PTY ID returned by terminalCreate — used for IPC data subscription and write. */
const ptyId = ref<string | null>(null)

/** Collapsible state keyed by "eventIndex-blockIndex". */
const collapsed = ref<Record<string, boolean>>({})

// ── Computed ─────────────────────────────────────────────────────────────────

/**
 * True while the last event is an assistant message (not yet followed by a result).
 * The result event marks the end of a turn.
 */
const isStreaming = computed(() => {
  if (events.value.length === 0) return false
  const last = events.value[events.value.length - 1]
  return last.type === 'assistant'
})

// ── IPC ──────────────────────────────────────────────────────────────────────

let unsubStreamMessage: (() => void) | null = null

async function sendMessage(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || !ptyId.value) return
  const msgText = text
  inputText.value = ''
  // Optimistic UI: display user bubble immediately before PTY write
  events.value.push({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: msgText }] }
  })
  await window.electronAPI.terminalWrite(ptyId.value, msgText + '\n')
  scrollToBottom()
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function toggleCollapsed(key: string): void {
  collapsed.value[key] = !collapsed.value[key]
}

function collapseKey(eventIdx: number, blockIdx: number): string {
  return `${eventIdx}-${blockIdx}`
}

function isCollapsed(eventIdx: number, blockIdx: number): boolean {
  const key = collapseKey(eventIdx, blockIdx)
  // thinking blocks are collapsed by default
  return collapsed.value[key] ?? false
}

function scrollToBottom(): void {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  // ── PTY creation (T597): start the Claude process with --output-format stream-json
  const tab = tabsStore.tabs.find(t => t.id === props.terminalId)
  if (tab) {
    try {
      const id = await window.electronAPI.terminalCreate(
        80, 24,
        tasksStore.projectPath ?? undefined,
        tab.wslDistro ?? undefined,
        tab.systemPrompt ?? undefined,
        tab.autoSend ?? undefined,
        tab.thinkingMode ?? undefined,
        tab.claudeCommand ?? undefined,
        tab.convId ?? undefined,
        undefined,
        'stream-json'
      )
      ptyId.value = id
      tabsStore.setPtyId(props.terminalId, id)

      // Subscribe to JSONL stream events using the ptyId (data channel is terminal:data:<ptyId>)
      unsubStreamMessage = window.electronAPI.onTerminalStreamMessage(
        id,
        (raw: Record<string, unknown>) => {
          const event = raw as StreamEvent
          if (event.type === 'system' && event.subtype === 'init') {
            sessionId.value = event.session_id ?? null
            // Synthetic user bubble for the initial autoSend prompt
            if (tab?.autoSend) {
              events.value.push({
                type: 'user',
                message: { role: 'user', content: [{ type: 'text', text: tab.autoSend }] }
              })
            }
          }
          events.value.push(event)
          scrollToBottom()
        }
      )
    } catch (err) {
      // PTY spawn error — show inline error
      events.value.push({ type: 'system', subtype: 'init', session_id: `Erreur PTY: ${String(err)}` })
    }
  }
})

onUnmounted(() => {
  unsubStreamMessage?.()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolInputPreview(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function toolResultText(content: StreamContentBlock['content']): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => c.text ?? '').join('\n')
  }
  return String(content)
}
</script>

<template>
  <div class="flex flex-col h-full bg-zinc-950 text-zinc-100 font-mono text-sm">
    <!-- ── Messages scroll area ─────────────────────────────────────────── -->
    <div
      ref="scrollContainer"
      class="flex-1 overflow-y-auto px-4 py-4 space-y-3"
    >
      <!-- No messages placeholder -->
      <div
        v-if="events.length === 0 && !isStreaming"
        class="flex items-center justify-center h-full text-zinc-500 text-xs"
        data-testid="empty-state"
      >
        En attente de messages…
      </div>

      <template
        v-for="(event, eIdx) in events"
        :key="eIdx"
      >
        <!-- system:init -->
        <div
          v-if="event.type === 'system' && event.subtype === 'init'"
          class="text-zinc-500 text-xs italic"
          data-testid="block-system-init"
        >
          Session démarrée
          <span
            v-if="event.session_id"
            class="ml-1 font-mono"
          >· {{ event.session_id.slice(0, 8) }}…</span>
        </div>

        <!-- user message — bulle utilisateur alignée à droite -->
        <div
          v-if="event.type === 'user' && event.message"
          class="flex justify-end"
          data-testid="block-user"
        >
          <div class="bg-violet-900 border border-violet-700 rounded-lg px-4 py-3 max-w-[80%] whitespace-pre-wrap text-sm text-violet-100 leading-relaxed">
            <template v-for="(block, bIdx) in event.message.content" :key="bIdx">
              <span v-if="block.type === 'text'">{{ block.text }}</span>
            </template>
          </div>
        </div>

        <!-- assistant message blocks -->
        <template v-if="event.type === 'assistant' && event.message">
          <template
            v-for="(block, bIdx) in event.message.content"
            :key="`${eIdx}-${bIdx}`"
          >
            <!-- text block — bulle markdown -->
            <div
              v-if="block.type === 'text'"
              class="bg-zinc-800 rounded-lg px-4 py-3 border border-zinc-700 whitespace-pre-wrap leading-relaxed"
              data-testid="block-text"
            >
              {{ block.text }}
            </div>

            <!-- thinking block — collapsible grisé -->
            <div
              v-else-if="block.type === 'thinking'"
              class="border border-zinc-700 rounded-lg overflow-hidden"
              data-testid="block-thinking"
            >
              <button
                class="w-full flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 transition-colors text-zinc-400 text-xs"
                @click="toggleCollapsed(collapseKey(eIdx, bIdx))"
              >
                <span class="transition-transform duration-200" :class="isCollapsed(eIdx, bIdx) ? '' : 'rotate-90'">▶</span>
                <span>Thinking…</span>
              </button>
              <div
                v-show="!isCollapsed(eIdx, bIdx)"
                class="px-4 py-3 bg-zinc-900 text-zinc-400 text-xs whitespace-pre-wrap"
              >
                {{ block.text }}
              </div>
            </div>

            <!-- tool_use block — carte collapsible -->
            <div
              v-else-if="block.type === 'tool_use'"
              class="border border-violet-800 rounded-lg overflow-hidden"
              data-testid="block-tool-use"
            >
              <button
                class="w-full flex items-center gap-2 px-3 py-2 bg-violet-950 hover:bg-violet-900 transition-colors text-violet-300 text-xs"
                @click="toggleCollapsed(collapseKey(eIdx, bIdx))"
              >
                <span class="transition-transform duration-200" :class="isCollapsed(eIdx, bIdx) ? '' : 'rotate-90'">▶</span>
                <span class="font-semibold">{{ block.name }}</span>
                <span class="text-violet-500 ml-auto">outil</span>
              </button>
              <div
                v-show="!isCollapsed(eIdx, bIdx)"
                class="px-4 py-3 bg-zinc-900 text-xs text-zinc-300 overflow-x-auto"
              >
                <pre class="whitespace-pre-wrap">{{ toolInputPreview(block.input) }}</pre>
              </div>
            </div>

            <!-- tool_result block — sortie code -->
            <div
              v-else-if="block.type === 'tool_result'"
              class="border rounded-lg overflow-hidden"
              :class="block.is_error ? 'border-red-800 bg-red-950' : 'border-zinc-700 bg-zinc-900'"
              data-testid="block-tool-result"
            >
              <div class="px-3 py-1.5 text-xs flex items-center gap-2"
                :class="block.is_error ? 'text-red-400' : 'text-zinc-400'"
              >
                <span>{{ block.is_error ? '✗ Erreur' : '✓ Résultat' }}</span>
              </div>
              <pre
                class="px-4 py-2 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap"
              >{{ toolResultText(block.content) }}</pre>
            </div>
          </template>
        </template>

        <!-- result footer — coût / durée / tokens -->
        <div
          v-if="event.type === 'result'"
          class="flex flex-wrap gap-4 text-xs text-zinc-500 border-t border-zinc-800 pt-2"
          data-testid="block-result"
        >
          <span v-if="event.num_turns !== undefined">
            {{ event.num_turns }} tour{{ event.num_turns > 1 ? 's' : '' }}
          </span>
          <span v-if="event.cost_usd !== undefined">
            ${{ event.cost_usd.toFixed(4) }}
          </span>
          <span v-if="event.duration_ms !== undefined">
            {{ (event.duration_ms / 1000).toFixed(1) }}s
          </span>
          <span
            v-if="event.session_id"
            class="ml-auto font-mono text-zinc-600"
          >
            {{ event.session_id.slice(0, 8) }}…
          </span>
        </div>
      </template>

      <!-- Indicateur "en cours" -->
      <div
        v-if="isStreaming"
        class="flex items-center gap-2 text-zinc-400 text-xs"
        data-testid="streaming-indicator"
      >
        <span class="inline-flex gap-0.5">
          <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
          <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
          <span class="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
        </span>
        <span>En cours…</span>
      </div>
    </div>

    <!-- ── Input zone ──────────────────────────────────────────────────── -->
    <div class="border-t border-zinc-800 px-4 py-3 flex gap-2">
      <textarea
        v-model="inputText"
        rows="2"
        placeholder="Envoyer un message…"
        class="flex-1 resize-none bg-zinc-800 dark:bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
        @keydown="handleKeydown"
      />
      <button
        :disabled="!inputText.trim()"
        class="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors self-end"
        data-testid="send-button"
        @click="sendMessage"
      >
        Envoyer
      </button>
    </div>
  </div>
</template>
