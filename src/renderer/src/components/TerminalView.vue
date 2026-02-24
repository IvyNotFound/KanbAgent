<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'

const props = defineProps<{ tabId: string }>()

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
watch(() => tabsStore.activeTabId, (id) => {
  if (id === props.tabId) {
    requestAnimationFrame(() => {
      doFit()
      if (term) term.refresh(0, term.rows - 1)
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
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(container.value)

  // Wait for DOM to have proper dimensions before fitting
  await new Promise(r => setTimeout(r, 100))
  fitAddon.fit()
  term.refresh(0, term.rows - 1)

  const { cols, rows } = term
  const tab = tabsStore.tabs.find(t => t.id === props.tabId)
  ptyId = await window.electronAPI.terminalCreate(
    cols, rows,
    tasksStore.projectPath ?? undefined,
    tab?.wslUser ?? undefined
  )
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
  })

  term.onData(data => {
    window.electronAPI.terminalWrite(ptyId!, data)
  })

  // Auto-launch claude with the agent prompt as first message
  if (tab?.autoSend) {
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
