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
let webglAddon: WebglAddon | null = null
let unsubData: (() => void) | null = null
let unsubExit: (() => void) | null = null
let unsubConvId: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let ptyId: string | null = null
let autoSendTimeout: ReturnType<typeof setTimeout> | null = null
let fitTimeout: ReturnType<typeof setTimeout> | null = null
let resizeRafId: number | null = null
let xtermTextarea: HTMLTextAreaElement | null = null
let pasteHandler: ((e: ClipboardEvent) => void) | null = null
let contextMenuHandler: ((e: MouseEvent) => void) | null = null

function doFit() {
  if (!fitAddon || !term) return
  try {
    fitAddon.fit()
    if (ptyId) {
      window.electronAPI.terminalResize(ptyId, term.cols, term.rows)
    }
  } catch { /* ignore fit errors when hidden */ }
}

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
    scrollback: 150,
    // Disable built-in copy/paste — let Electron handle it to avoid character duplication
    copyOnSelect: false,
    rightClickSelectsWord: false,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container.value)

  // GPU acceleration: try WebGL renderer first, fallback to Canvas2D if GPU unavailable
  // WebGL: ~60-80% CPU reduction for intensive output; Canvas: stable 2D fallback (VM, GPU-less)
  // T559: store reference so we can dispose/recreate on tab switch to free GPU texture memory
  try {
    webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose()
      webglAddon = null
    })
    term.loadAddon(webglAddon)
  } catch {
    webglAddon = null
    // WebGL not available (sandboxed env, no GPU driver) — fall back to Canvas2D
    try {
      term.loadAddon(new CanvasAddon())
    } catch { /* Canvas also unavailable — xterm uses DOM renderer */ }
  }

  // Prevent xterm's native paste event — paste is handled exclusively by attachCustomKeyEventHandler
  // (Ctrl+V fires both a keydown and a paste DOM event; blocking paste here prevents double-write)
  // Use capture phase to run BEFORE xterm's handler, and stopImmediatePropagation to block xterm's handler
  xtermTextarea = container.value?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
  pasteHandler = (e: ClipboardEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  xtermTextarea?.addEventListener('paste', pasteHandler, true) // capture: true = runs before bubble phase handlers (like xterm's)

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
    const agentId = tasksStore.agents.find(a => a.name === tab.agentName)?.id
    if (agentId) {
      unsubConvId = window.electronAPI.onTerminalConvId(ptyId, (convId) => {
        if (!tasksStore.dbPath) return
        // T626: retry up to 3×2s — dbstart.js may not have created the session yet
        let attempts = 0
        const dbPath = tasksStore.dbPath
        const trySet = async (): Promise<void> => {
          try {
            const result = await window.electronAPI.setSessionConvId(dbPath, Number(agentId), convId) as { success: boolean; updated?: boolean; error?: string }
            if (result.success && result.updated) {
              unsubConvId?.()
              unsubConvId = null
              return
            }
          } catch (err) {
            console.warn('[TerminalView] setSessionConvId failed:', err)
          }
          attempts++
          if (attempts < 3) {
            setTimeout(() => { trySet() }, 2000)
          } else {
            unsubConvId?.()
            unsubConvId = null
            console.warn('[TerminalView] setSessionConvId: session not found after 3 attempts, giving up')
          }
        }
        trySet()
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
      // T518: collect token stats from JSONL after session closes
      window.electronAPI.collectSessionTokens(tasksStore.dbPath, tab.agentName)
        .catch(err => console.warn('[TerminalView] collectSessionTokens failed:', err))
    }
  })

  term.onData(data => {
    window.electronAPI.terminalWrite(ptyId!, data)
  })

  // Context menu for copy (since copyOnSelect is disabled)
  contextMenuHandler = (e: MouseEvent) => {
    e.preventDefault()
    const selection = term?.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    }
  }
  container.value?.addEventListener('contextmenu', contextMenuHandler)

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
    if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = null
      doFit()
    })
  })
  resizeObserver.observe(container.value)
})

// Pause/resume listeners when terminal becomes inactive/active
// Declared at top-level setup so Vue auto-stops the watcher on unmount
const isActive = computed(() => props.isActive ?? true)
let isPaused = false

function pauseListeners() {
  if (isPaused || !ptyId) return
  isPaused = true
  unsubExit?.()
  unsubExit = null
  // T559: dispose WebGL renderer when inactive — releases GPU texture, xterm falls back to DOM
  if (webglAddon) {
    webglAddon.dispose()
    webglAddon = null
  }
}

function resumeListeners() {
  if (!isPaused || !ptyId) return
  isPaused = false
  unsubExit = window.electronAPI.onTerminalExit(ptyId, () => {
    term?.clear()
    term?.write('\r\n\x1b[31m[session terminée]\x1b[0m\r\n')
    const tab = tabsStore.tabs.find(t => t.id === props.tabId)
    if (tab?.agentName && tasksStore.dbPath) {
      window.electronAPI.closeAgentSessions(tasksStore.dbPath, tab.agentName)
      // T518: collect token stats from JSONL after session closes
      window.electronAPI.collectSessionTokens(tasksStore.dbPath, tab.agentName)
        .catch(err => console.warn('[TerminalView] collectSessionTokens failed:', err))
    }
  })
  // T559: recreate WebGL renderer when tab becomes active — restores GPU acceleration
  if (term && !webglAddon) {
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      term.loadAddon(webglAddon)
    } catch {
      webglAddon = null // WebGL unavailable — DOM renderer already active, no action needed
    }
  }
}

watch(isActive, (active) => {
  if (active) {
    resumeListeners()
    // 200ms delay + rAF ensures DOM has proper dimensions after display:none→flex transition
    if (fitTimeout) clearTimeout(fitTimeout)
    fitTimeout = setTimeout(() => {
      fitTimeout = null
      requestAnimationFrame(() => {
        doFit()
        if (term) {
          term.scrollToBottom()
          term.focus()
        }
      })
    }, 200)
  } else {
    if (fitTimeout) { clearTimeout(fitTimeout); fitTimeout = null }
    pauseListeners()
  }
}, { immediate: true })

onUnmounted(() => {
  if (ptyId) window.electronAPI.terminalKill(ptyId)
  if (fitTimeout) { clearTimeout(fitTimeout); fitTimeout = null }
  if (resizeRafId !== null) { cancelAnimationFrame(resizeRafId); resizeRafId = null }
  if (autoSendTimeout) clearTimeout(autoSendTimeout)
  unsubData?.()
  unsubExit?.()
  unsubConvId?.()
  resizeObserver?.disconnect()
  if (pasteHandler && xtermTextarea) {
    xtermTextarea.removeEventListener('paste', pasteHandler, true)
    pasteHandler = null
  }
  if (contextMenuHandler && container.value) {
    container.value.removeEventListener('contextmenu', contextMenuHandler)
    contextMenuHandler = null
  }
  xtermTextarea = null
  webglAddon?.dispose()
  term?.dispose()
  // xterm 5.5 disposes its PerformanceObserver on term.dispose() — clear any
  // residual entries as a safety net to prevent PerformanceEventTiming accumulation
  performance.clearMeasures()
  performance.clearMarks()
})
</script>

<template>
  <div ref="container" class="w-full h-full bg-[#09090b] pl-2" style="transform: translateZ(0)" />
</template>
