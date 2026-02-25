<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
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
let unsubConvId: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let ptyId: string | null = null
let autoSendTimeout: ReturnType<typeof setTimeout> | null = null
let fitTimeout: ReturnType<typeof setTimeout> | null = null

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
// Use setTimeout 200ms + requestAnimationFrame to ensure DOM has proper dimensions before fit
// fitTimeout is stored so it can be cancelled in onUnmounted if component is destroyed before expiry
watch(() => tabsStore.activeTabId, (id) => {
  if (id === props.tabId) {
    if (fitTimeout) clearTimeout(fitTimeout)
    fitTimeout = setTimeout(() => {
      fitTimeout = null
      requestAnimationFrame(() => {
        doFit()
        if (term) {
          term.refresh(0, term.rows - 1)
          term.scrollToBottom()
          term.focus()
        }
      })
    }, 200)
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
    cursorBlink: false, // Disabled to prevent ghost cursor effect during frequent terminal updates
    allowTransparency: true,
    scrollback: 500,
    // Disable built-in copy/paste — let Electron handle it to avoid character duplication
    copyOnSelect: false,
    rightClickSelectsWord: false,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container.value)

  // GPU acceleration: try WebGL renderer first, fallback to Canvas2D if GPU unavailable
  // WebGL: ~60-80% CPU reduction for intensive output; Canvas: stable 2D fallback (VM, GPU-less)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose()) // dispose if GPU context is lost (e.g. sleep/wake)
    term.loadAddon(webgl)
  } catch {
    // WebGL not available (sandboxed env, no GPU driver) — fall back to Canvas2D
    try {
      term.loadAddon(new CanvasAddon())
    } catch { /* Canvas also unavailable — xterm uses DOM renderer */ }
  }

  // Prevent xterm's native paste event — paste is handled exclusively by attachCustomKeyEventHandler
  // (Ctrl+V fires both a keydown and a paste DOM event; blocking paste here prevents double-write)
  // Use capture phase to run BEFORE xterm's handler, and stopImmediatePropagation to block xterm's handler
  const xtermTextarea = container.value?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
  xtermTextarea?.addEventListener('paste', (e) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true) // capture: true = runs before bubble phase handlers (like xterm's)

  // Wait for DOM to have proper dimensions before fitting
  // Use nextTick + Promise-based delay for more precise timing
  await nextTick()
  await new Promise(r => requestAnimationFrame(r))
  fitAddon.fit()
  term.refresh(0, term.rows - 1)
  term.focus()

  const { cols, rows } = term
  const tab = tabsStore.tabs.find(t => t.id === props.tabId)

  // If systemPrompt is provided, launch Claude directly with the system prompt
  // Otherwise, use the traditional approach with autoSend
  // convId (task #218): if a previous session UUID exists, pass it for --resume
  // Wrap in try/catch: backend throws WSL_SPAWN_ERROR if wsl.exe fails (e.g. WSL not started)
  try {
    if (tab?.convId) {
      // Resume mode: skip system prompt injection, Claude restores conversation state
      ptyId = await window.electronAPI.terminalCreate(
        cols, rows,
        tasksStore.projectPath ?? undefined,
        tab.wslDistro ?? undefined,
        undefined,
        undefined,
        undefined,
        tab?.claudeCommand ?? undefined,
        tab.convId
      )
    } else if (tab?.systemPrompt && tab?.autoSend) {
      ptyId = await window.electronAPI.terminalCreate(
        cols, rows,
        tasksStore.projectPath ?? undefined,
        tab.wslDistro ?? undefined,
        tab.systemPrompt,
        tab.autoSend,
        tab.thinkingMode ?? undefined,
        tab.claudeCommand ?? undefined
      )
    } else {
      ptyId = await window.electronAPI.terminalCreate(
        cols, rows,
        tasksStore.projectPath ?? undefined,
        tab?.wslDistro ?? undefined,
        undefined,
        undefined,
        undefined,
        tab?.claudeCommand ?? undefined
      )
    }
  } catch (err) {
    // Display WSL spawn error inline in the terminal (user-friendly ANSI message)
    term?.write(`\r\n\x1b[31m[Erreur WSL] ${String(err)}\x1b[0m\r\n`)
    term?.write('\x1b[33mFix: wsl --shutdown puis réessayer\x1b[0m\r\n')
    return // ptyId stays null — no listeners attached
  }
  tabsStore.setPtyId(props.tabId, ptyId)
  // Immediate agent status refresh after session start (avoids waiting for 1s poll)
  tasksStore.agentRefresh()

  // Rename tab on OSC 0/2 title change — sauf si l'onglet a un agentName fixé
  // (le shell PROMPT_COMMAND écraserait sinon le nom de l'agent à chaque prompt)
  term.onTitleChange(title => {
    if (!tab?.agentName) tabsStore.renameTab(props.tabId, title)
  })

  // ── Conv ID capture (task #218) ───────────────────────────────────────────
  // Store the detected conversation UUID in the DB for future --resume launches.
  // Only active for agent sessions (tab has agentName and tasksStore provides agentId).
  if (tab?.agentName && tasksStore.dbPath) {
    const agentRows = await window.electronAPI.queryDb(
      tasksStore.dbPath,
      'SELECT id FROM agents WHERE name = ? LIMIT 1',
      [tab.agentName]
    ) as Array<{ id: number }>
    if (agentRows.length > 0) {
      const agentId = agentRows[0].id
      unsubConvId = window.electronAPI.onTerminalConvId(ptyId, (convId) => {
        // Store in DB for future --resume
        if (tasksStore.dbPath) {
          window.electronAPI.setSessionConvId(tasksStore.dbPath, agentId, convId)
            .catch(err => console.warn('[TerminalView] setSessionConvId failed:', err))
        }
        // Unsubscribe after first detection
        unsubConvId?.()
        unsubConvId = null
      })
    }
  }

  // Combined data + activity listener: writes to xterm when active, always marks activity for spinner
  // Single IPC listener instead of two (reduces 2N to N listeners for N terminals)
  unsubData = window.electronAPI.onTerminalData(ptyId, (data) => {
    tabsStore.markTabActive(props.tabId) // always track activity
    if (!isPaused) term?.write(data)     // only write to xterm when tab is active
  })

  unsubExit = window.electronAPI.onTerminalExit(ptyId, () => {
    term?.clear()
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
    autoSendTimeout = setTimeout(() => {
      if (pid) window.electronAPI.terminalWrite(pid, `claude "${escaped}"\r`)
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
    // Note: unsubData stays subscribed to track activity even when paused
    // Only unsubExit is cleaned up (terminal not writing anymore)
    unsubExit?.()
    unsubExit = null
  }

  function resumeListeners() {
    if (!isPaused || !ptyId) return
    isPaused = false
    // Re-subscribe exit handler only (unsubData stays active for activity tracking)
    unsubExit = window.electronAPI.onTerminalExit(ptyId, () => {
      term?.clear()
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
  if (fitTimeout) { clearTimeout(fitTimeout); fitTimeout = null }
  if (autoSendTimeout) clearTimeout(autoSendTimeout)
  unsubData?.()
  unsubExit?.()
  unsubConvId?.()
  resizeObserver?.disconnect()
  term?.dispose()
})
</script>

<template>
  <div ref="container" class="w-full h-full bg-[#09090b] pl-2" style="transform: translateZ(0)" />
</template>
