import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentsStore } from '@renderer/stores/agents'
import { useI18n } from 'vue-i18n'
import { renderMarkdown } from '@renderer/utils/renderMarkdown'
import { parsePromptContext } from '@renderer/utils/parsePromptContext'
import type { StreamEvent, StreamContentBlock } from '@renderer/types/stream'
import type { PendingPermission } from '@renderer/components/PermissionRequestBanner.vue'

/**
 * Manages all IPC lifecycle for a StreamView tab: agent creation, event subscriptions,
 * autoSend, permission requests, exit handling, and link click interception.
 */
export function useStreamIpc(options: {
  terminalId: string
  events: Ref<StreamEvent[]>
  enqueueEvent: (raw: Record<string, unknown>) => void
  assignEventId: (e: StreamEvent) => void
  scrollToBottom: (force?: boolean) => void
  scrollContainer: Ref<HTMLElement | null>
  isStreaming: ComputedRef<boolean>
}) {
  const { terminalId, events, enqueueEvent, assignEventId, scrollToBottom, scrollContainer, isStreaming } = options

  const tabsStore = useTabsStore()
  const tasksStore = useTasksStore()
  const settingsStore = useSettingsStore()
  const agentsStore = useAgentsStore()
  const { t } = useI18n()

  const sessionId = ref<string | null>(null)
  const ptyId = ref<string | null>(null)
  const agentStopped = ref(false)
  const prefillAnswer = ref<string | undefined>(undefined)
  const pendingPermissions = ref<PendingPermission[]>([])

  function handleSelectOption(label: string): void {
    prefillAnswer.value = label
  }

  async function handleSend(text: string, atts: { path: string; objectUrl: string }[] = []): Promise<void> {
    agentStopped.value = false
    // Strip 📎 path lines for display — agent still receives the full text with paths (T1736)
    const displayText = text.replace(/(\n)?📎 [^\n]+/g, '').trim()
    const content: StreamContentBlock[] = [
      ...(displayText ? [{ type: 'text' as const, text: displayText, _html: renderMarkdown(displayText) }] : []),
      ...atts.map(a => ({ type: 'image_ref' as const, path: a.path, objectUrl: a.objectUrl })),
    ]
    const userEvent: StreamEvent = { type: 'user', message: { role: 'user', content } }
    assignEventId(userEvent)
    events.value.push(userEvent)
    scrollToBottom(true)
    try {
      if (ptyId.value) await window.electronAPI.agentSend(ptyId.value, text)
    } catch (err) {
      const errEvent: StreamEvent = { type: 'system', subtype: 'error', session_id: `Erreur agent: ${String(err)}` }
      assignEventId(errEvent)
      events.value.push(errEvent)
    }
  }

  function handleStop(): void {
    if (!ptyId.value || agentStopped.value) return
    agentStopped.value = true
    window.electronAPI.agentKill(ptyId.value)
  }

  async function handlePermissionRespond(permissionId: string, behavior: 'allow' | 'deny'): Promise<void> {
    const perm = pendingPermissions.value.find(p => p.permission_id === permissionId)
    if (!perm) return

    await window.electronAPI.permissionRespond(permissionId, behavior)
    pendingPermissions.value = pendingPermissions.value.filter(p => p.permission_id !== permissionId)

    const label = behavior === 'allow'
      ? t('stream.permissionAllowed', { tool: perm.tool_name })
      : t('stream.permissionDenied', { tool: perm.tool_name })
    const userEvent: StreamEvent = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: label, _html: renderMarkdown(label) }] },
    }
    assignEventId(userEvent)
    events.value.push(userEvent)
    scrollToBottom(true)
  }

  // Redirect markdown link clicks to system browser (T753).
  function handleLinkClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href || !/^https?:\/\//i.test(href)) return
    e.preventDefault(); e.stopPropagation()
    window.electronAPI.openExternal(href)
  }

  let unsubStreamMessage: (() => void) | null = null
  let unsubConvId: (() => void) | null = null
  let unsubExit: (() => void) | null = null
  let unsubPermission: (() => void) | null = null

  onMounted(async () => {
    const tab = tabsStore.tabs.find(t => t.id === terminalId)
    if (!tab) return

    if (tab.convId && !tab.autoSend) sessionId.value = tab.convId

    try {
      const id = await window.electronAPI.agentCreate({
        projectPath: tasksStore.projectPath ?? undefined,
        workDir: tab.workDir ?? undefined,
        wslDistro: tab.wslDistro ?? undefined,
        systemPrompt: tab.systemPrompt ?? undefined,
        thinkingMode: tab.thinkingMode ?? undefined,
        customBinaryName: tab.customBinaryName ?? undefined,
        convId: tab.convId ?? undefined,
        cli: tab.cli ?? undefined,
        modelId: tab.modelId ?? undefined,
        initialMessage: tab.autoSend ?? undefined,
      })
      ptyId.value = id
      tabsStore.setPtyId(terminalId, id)
      tabsStore.setStreamId(terminalId, id)

      unsubStreamMessage = window.electronAPI.onAgentStream(id, (raw: Record<string, unknown>) => {
        enqueueEvent(raw)
      })
      unsubConvId = window.electronAPI.onAgentConvId(id, (convId: string) => { sessionId.value = convId })

      // T1817: subscribe to permission requests — filter by session_id match
      unsubPermission = window.electronAPI.onPermissionRequest((data) => {
        if (sessionId.value && data.session_id !== sessionId.value) return
        pendingPermissions.value.push({
          permission_id: data.permission_id,
          tool_name: data.tool_name,
          tool_input: data.tool_input,
        })
        scrollToBottom(true)
      })

      unsubExit = window.electronAPI.onAgentExit(id, (exitCode: number | null) => {
        if (isStreaming.value) { const e: StreamEvent = { type: 'result' }; assignEventId(e); events.value.push(e) }
        // T1930: only auto-close if setting is enabled; skip interactive agents
        // T1937: only auto-close on clean exit (0) — keep tab visible on crash for diagnosis
        if (settingsStore.autoLaunchAgentSessions && exitCode === 0) {
          const tb = tabsStore.tabs.find(tb => tb.id === terminalId)
          if (tb) {
            const agent = agentsStore.agents.find(a => a.name === tb.agentName)
            const isPlanner = agent?.type === 'planner'
            if (!isPlanner) {
              setTimeout(() => tabsStore.closeTab(terminalId), 3000)
            }
          }
        }
      })

      if (tab.autoSend) {
        const autoEvent: StreamEvent = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: tab.autoSend, _html: renderMarkdown(parsePromptContext(tab.autoSend).base) }] } }
        assignEventId(autoEvent)
        events.value.push(autoEvent)
        scrollToBottom(true)
        // opencode/gemini: initial message was passed as positional arg via agentCreate(initialMessage)
        if (tab.cli !== 'opencode' && tab.cli !== 'gemini') {
          await window.electronAPI.agentSend(id, tab.autoSend)
        }
      }
    } catch (err) {
      const e: StreamEvent = { type: 'system', subtype: 'init', session_id: `Erreur agent: ${String(err)}` }
      assignEventId(e)
      events.value.push(e)
    }

    await nextTick()
    scrollContainer.value?.addEventListener('click', handleLinkClick, true)
  })

  onUnmounted(() => {
    unsubStreamMessage?.(); unsubConvId?.(); unsubExit?.(); unsubPermission?.()
    scrollContainer.value?.removeEventListener('click', handleLinkClick, true)
    tabsStore.setStreamId(terminalId, null)
    if (ptyId.value && !agentStopped.value) window.electronAPI.agentKill(ptyId.value)
  })

  return { sessionId, ptyId, agentStopped, prefillAnswer, pendingPermissions, handleStop, handleSend, handlePermissionRespond, handleSelectOption }
}
