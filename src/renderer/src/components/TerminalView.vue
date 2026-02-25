<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'

const props = defineProps<{ tabId: string; isActive?: boolean }>()

const tabsStore = useTabsStore()
const tasksStore = useTasksStore()
const container = ref<HTMLElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let unsubData: (() => void) | null = null
let unsubExit: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let ptyId: string | null = null

function doFit() {
  if (!fitAddon || !term) return
  try {
    fitAddon.fit()
    if (ptyId) {
      window.electronAPI.terminalResize(ptyId, term.cols, term.rows)
    }
  } catch { /* ignore fit errors when hidden */ }
}

// Re-fit and refresh when this tab becomes active (was hidden with display:none)
// scrollToBottom fixes viewport reset to top that happens after fit() on resize
watch(() => tabsStore.activeTabId, (id) => {
  if (id === props.tabId) {
    requestAnimationFrame(() => {
      doFit()
      if (term) {
        term.refresh(0, term.rows - 1)
        term.scrollToBottom()
        term.focus()
      }
    })
  }
})

onMounted(async () => {
  if (!container.value) return

  term = new Terminal({
    theme: {
      background: '#09090b',
      foreground: '#f4f4f5',
      cursor: '#8b5cf6',
      cursorAccent: '#09090b',
      selectionBackground: '#8b5cf640',
      black: '#18181b',
      brightBlack: '#3f3f46',
      red: '#f87171',
      brightRed: '#fca5a5',
      green: '#4ade80',
      brightGreen: '#86efac',
      yellow: '#facc15',
      brightYellow: '#fde047',
      blue: '#60a5fa',
      brightBlue: '#93c5fd',
      magenta: '#c084fc',
      brightMagenta: '#d8b4fe',
      cyan: '#22d3ee',
      brightCyan: '#67e8f9',
      white: '#e4e4e7',
      brightWhite: '#f4f4f5',
    },
    fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 5000,
    // Disable built-in copy/paste — let Electron handle it to avoid character duplication
    copyOnSelect: false,
    rightClickSelectsWord: false,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container.value)

  // Wait for DOM to have proper dimensions before fitting
  await new Promise(r => setTimeout(r, 100))
  fitAddon.fit()
  term.refresh(0, term.rows - 1)
  term.focus()

  const { cols, rows } = term
  const tab = tabsStore.tabs.find(t => t.id === props.tabId)

  // If systemPrompt is provided, launch Claude directly with the system prompt
  // Otherwise, use the traditional approach with autoSend
  if (tab?.systemPrompt && tab?.autoSend) {
    ptyId = await window.electronAPI.terminalCreate(
      cols, rows,
      tasksStore.projectPath ?? undefined,
      tab.wslUser ?? undefined,
      tab.systemPrompt,
      tab.autoSend,
      tab.thinkingMode ?? undefined
    )
  } else {
    ptyId = await window.electronAPI.terminalCreate(
      cols, rows,
      tasksStore.projectPath ?? undefined,
      tab?.wslUser ?? undefined
    )
  }
  tabsStore.setPtyId(props.tabId, ptyId)

  // Rename tab on OSC 0/2 title change — sauf si l'onglet a un agentName fixé
  // (le shell PROMPT_COMMAND écraserait sinon le nom de l'agent à chaque prompt)
  term.onTitleChange(title => {
    if (!tab?.agentName) tabsStore.renameTab(props.tabId, title)
  })

  unsubData = window.electronAPI.onTerminalData(ptyId, (data) => {
    term?.write(data)
    tabsStore.markTabActive(props.tabId)
  })

  unsubExit = window.electronAPI.onTerminalExit(ptyId, () => {
    term?.write('\r\n\x1b[31m[session terminée]\x1b[0m\r\n')
    // Auto-close agent DB sessions when the terminal exits
    const tab = tabsStore.tabs.find(t => t.id === props.tabId)
    if (tab?.agentName && tasksStore.dbPath) {
      window.electronAPI.closeAgentSessions(tasksStore.dbPath, tab.agentName)
    }
  })

  term.onData(data => {
    window.electronAPI.terminalWrite(ptyId!, data)
  })

  // Context menu for copy (since copyOnSelect is disabled)
  container.value?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const selection = term?.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    }
  })

  // Ctrl+C and Ctrl+V intercepted by Electron before xterm — handle copy/paste manually
  term.attachCustomKeyEventHandler((e) => {
    // Ctrl+V: paste
    if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
      navigator.clipboard.readText().then(text => {
        if (text) window.electronAPI.terminalWrite(ptyId!, text)
      })
      return false
    }
    // Ctrl+C: copy selected text if selection, otherwise let xterm send SIGINT
    if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
      const selection = term?.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
        return false
      }
      return true
    }
    return true
  })

  // Auto-launch claude with the agent prompt as first message (only when NOT using systemPrompt injection)
  if (tab?.autoSend && !tab?.systemPrompt) {
    const escaped = tab.autoSend.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const pid = ptyId
    setTimeout(() => {
      window.electronAPI.terminalWrite(pid, `claude "${escaped}"\r`)
    }, 600)
  }

  resizeObserver = new ResizeObserver(() => {
    doFit()
  })
  resizeObserver.observe(container.value)

  // Pause/resume listeners when terminal becomes inactive/active
  // This prevents memory leaks when multiple terminals are kept mounted
  const isActive = computed(() => props.isActive ?? true)
  let dataHandler: ((data: string) => void) | null = null
  let exitHandler: (() => void) | null = null
  let isPaused = false

  function pauseListeners() {
    if (isPaused || !ptyId) return
    isPaused = true
    // Clean up IPC listeners
    unsubData?.()
    unsubExit?.()
    unsubData = null
    unsubExit = null
  }

  function resumeListeners() {
    if (!isPaused || !ptyId) return
    isPaused = false
    // Re-subscribe to IPC events
    unsubData = window.electronAPI.onTerminalData(ptyId, (data) => {
      term?.write(data)
      tabsStore.markTabActive(props.tabId)
    })
    unsubExit = window.electronAPI.onTerminalExit(ptyId, () => {
      term?.write('\r\n\x1b[31m[session terminée]\x1b[0m\r\n')
      const tab = tabsStore.tabs.find(t => t.id === props.tabId)
      if (tab?.agentName && tasksStore.dbPath) {
        window.electronAPI.closeAgentSessions(tasksStore.dbPath, tab.agentName)
      }
    })
  }

  watch(() => isActive.value, (active) => {
    if (active) {
      resumeListeners()
      // Re-fit when becoming active
      requestAnimationFrame(() => {
        doFit()
        if (term) {
          term.refresh(0, term.rows - 1)
          term.scrollToBottom()
          term.focus()
        }
      })
    } else {
      pauseListeners()
    }
  }, { immediate: true })
})

onUnmounted(() => {
  if (ptyId) window.electronAPI.terminalKill(ptyId)
  unsubData?.()
  unsubExit?.()
  resizeObserver?.disconnect()
  term?.dispose()
})
</script>

<template>
  <div ref="container" class="w-full h-full bg-[#09090b]" style="transform: translateZ(0)" />
</template>
