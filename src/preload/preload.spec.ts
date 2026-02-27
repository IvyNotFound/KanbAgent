import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ── ANSI regex used in onTerminalStreamMessage (T621) ────────────────────────
// Replicated here to unit-test stripping logic in isolation.
// Keep in sync with src/preload/index.ts.
const ansiRe = /\x1b\[[0-9;?]*[a-zA-Z]|\x9b[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[<-Z\\-_]|[\x80-\x9a\x9c-\x9f]/g
function stripAnsiForJson(line: string): string {
  return line.replace(ansiRe, '').trim()
}

// Read the preload source file to parse exposed methods - use process.cwd() for correct path
const preloadSource = fs.readFileSync(
  path.join(process.cwd(), 'src/preload/index.ts'),
  'utf-8'
)

// Extract method names from contextBridge.exposeInMainWorld calls
// Match lines like:   methodName: (
const methodMatches = preloadSource.match(/^\s{2}(\w+):\s*\(/gm)
const exposedMethods = methodMatches
  ? methodMatches.map(m => m.replace(/^\s{2}/, '').replace(/\s*:\s*\($/, ''))
  : []

describe('preload/index', () => {
  it('should expose electronAPI via contextBridge', () => {
    // Verify the preload file contains contextBridge.exposeInMainWorld
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('electronAPI'")
  })

  it('should expose all required project methods', () => {
    const requiredProjectMethods = [
      'selectProjectDir',
      'createProjectDb',
      'queryDb',
      'watchDb',
      'unwatchDb',
      'onDbChanged',
      'showConfirmDialog',
      'selectNewProjectDir',
      'initNewProject',
      'findProjectDb',
      'migrateDb',
      'getLocks',
    ]

    for (const method of requiredProjectMethods) {
      expect(exposedMethods).toContain(method)
    }
  })

  it('should expose all required file system methods', () => {
    const requiredFsMethods = ['fsListDir', 'fsReadFile', 'fsWriteFile']

    for (const method of requiredFsMethods) {
      expect(exposedMethods).toContain(method)
    }
  })

  it('should expose all required window methods', () => {
    const requiredWindowMethods = [
      'windowMinimize',
      'windowMaximize',
      'windowClose',
      'windowIsMaximized',
      'onWindowStateChange',
    ]

    for (const method of requiredWindowMethods) {
      expect(exposedMethods).toContain(method)
    }
  })

  it('should expose all required terminal methods', () => {
    const requiredTerminalMethods = [
      'getWslUsers',
      'getClaudeProfiles',
      'getClaudeInstances',
      'terminalCreate',
      'terminalWrite',
      'terminalResize',
      'terminalKill',
      'terminalIsAlive',
      'onTerminalData',
      'onTerminalExit',
      'onTerminalConvId',
      'terminalRelaunch',
      'terminalDismissCrash',
      'terminalGetActiveCount',
      'terminalGetMemoryStatus',
      'onMemoryStatus',
      'terminalReleaseMemory',
    ]

    for (const method of requiredTerminalMethods) {
      expect(exposedMethods).toContain(method)
    }
  })

  it('should expose all required agent methods', () => {
    const requiredAgentMethods = [
      'closeAgentSessions',
      'renameAgent',
      'updatePerimetre',
      'updateAgentSystemPrompt',
      'buildAgentPrompt',
      'getAgentSystemPrompt',
      'updateAgentThinkingMode',
      'updateAgent',
      'createAgent',
      'setSessionConvId',
    ]

    for (const method of requiredAgentMethods) {
      expect(exposedMethods).toContain(method)
    }
  })

  it('should expose all required config methods', () => {
    expect(exposedMethods).toContain('getConfigValue')
    expect(exposedMethods).toContain('setConfigValue')
  })

  it('should expose CLAUDE.md sync methods', () => {
    expect(exposedMethods).toContain('checkMasterClaudeMd')
    expect(exposedMethods).toContain('applyMasterClaudeMd')
  })

  it('should expose GitHub and search methods', () => {
    expect(exposedMethods).toContain('testGithubConnection')
    expect(exposedMethods).toContain('checkForUpdates')
    expect(exposedMethods).toContain('searchTasks')
    expect(exposedMethods).toContain('tasksGetArchived')
  })

  it('should expose agent management methods (T437/T438)', () => {
    expect(exposedMethods).toContain('deleteAgent')
    expect(exposedMethods).toContain('addPerimetre')
  })

  it('should expose total of 40+ API methods', () => {
    expect(exposedMethods.length).toBeGreaterThanOrEqual(40)
  })

  it('should use ipcRenderer.invoke for queryDb', () => {
    // Verify queryDb uses ipcRenderer.invoke
    expect(preloadSource).toContain("ipcRenderer.invoke('query-db'")
  })

  it('should use ipcRenderer.invoke for terminal methods', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('terminal:create'")
    expect(preloadSource).toContain("ipcRenderer.invoke('terminal:write'")
    expect(preloadSource).toContain("ipcRenderer.invoke('terminal:resize'")
    expect(preloadSource).toContain("ipcRenderer.invoke('terminal:kill'")
  })

  it('should use ipcRenderer.on for subscription methods', () => {
    // Verify subscription methods use ipcRenderer.on
    expect(preloadSource).toContain("ipcRenderer.on('db-changed'")
    expect(preloadSource).toContain('ipcRenderer.on(channel, handler)')
    expect(preloadSource).toContain("ipcRenderer.on('window-state-changed'")
  })

  it('should use ipcRenderer.off for unsubscribing', () => {
    // Verify subscription methods return unsubscribe functions
    expect(preloadSource).toContain('ipcRenderer.off')
  })

  it('should pass dbPath to queryDb', () => {
    // Verify queryDb signature includes dbPath as first parameter
    const queryDbMatch = preloadSource.match(/queryDb:\s*\([^)]+\)/)
    expect(queryDbMatch).toBeTruthy()
    expect(queryDbMatch![0]).toContain('dbPath')
  })
})

// ── onTerminalStreamMessage ANSI stripping (T621) ─────────────────────────────
describe('preload — ANSI strip for onTerminalStreamMessage', () => {
  it('strips basic CSI SGR sequences (existing T617 coverage)', () => {
    expect(stripAnsiForJson('\x1b[0m{"type":"result"}')).toBe('{"type":"result"}')
    expect(stripAnsiForJson('\x1b[1;32m{"type":"system"}\x1b[0m')).toBe('{"type":"system"}')
  })

  it('strips CSI private-mode sequences (?)', () => {
    // \x1b[?25l = cursor hide — emitted by some CLI tools even with TERM=dumb
    expect(stripAnsiForJson('\x1b[?25l{"type":"assistant"}')).toBe('{"type":"assistant"}')
    expect(stripAnsiForJson('\x1b[?25h{"type":"user"}')).toBe('{"type":"user"}')
  })

  it('strips OSC sequences \\x1b]...\\x07 (primary T621 regression)', () => {
    // Claude Code emits \x1b]0;title\x07 to set the terminal title
    // before each output line — this corrupts JSON.parse even with TERM=dumb
    const line = '\x1b]0;claude\x07{"type":"assistant","message":{"role":"assistant","content":[]}}'
    expect(stripAnsiForJson(line)).toBe('{"type":"assistant","message":{"role":"assistant","content":[]}}')
  })

  it('strips OSC sequences \\x1b]...\\x1b\\\\ (ST terminator variant)', () => {
    const line = '\x1b]0;title\x1b\\{"type":"result","cost_usd":0.001}'
    expect(stripAnsiForJson(line)).toBe('{"type":"result","cost_usd":0.001}')
  })

  it('strips 8-bit CSI sequences (\\x9b)', () => {
    expect(stripAnsiForJson('\x9b0m{"type":"user"}')).toBe('{"type":"user"}')
  })

  it('strips Fe escape sequences (\\x1b followed by @-Z, \\-_)', () => {
    // \x1bM = reverse index, \x1b= = keypad application mode
    expect(stripAnsiForJson('\x1bM{"type":"system"}')).toBe('{"type":"system"}')
    expect(stripAnsiForJson('\x1b={"type":"result"}')).toBe('{"type":"result"}')
  })

  it('strips C1 control codes (\\x80-\\x9f range)', () => {
    expect(stripAnsiForJson('\x84{"type":"assistant"}')).toBe('{"type":"assistant"}')
  })

  it('preserves valid JSON content after stripping', () => {
    const json = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello!"}]}}'
    expect(stripAnsiForJson(json)).toBe(json)
  })

  it('trims whitespace and carriage returns', () => {
    expect(stripAnsiForJson('  {"type":"result"}  ')).toBe('{"type":"result"}')
    expect(stripAnsiForJson('\r{"type":"system"}\r')).toBe('{"type":"system"}')
  })
})
