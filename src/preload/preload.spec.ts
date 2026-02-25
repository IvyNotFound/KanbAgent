import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

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
      'getLocksCount',
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
      'getClaudeInstances',
      'terminalCreate',
      'terminalWrite',
      'terminalResize',
      'terminalKill',
      'onTerminalData',
      'onTerminalExit',
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
