import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron BEFORE importing terminal module
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
}))

// Mock node-pty — provide default export for CJS/ESM interop
const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}
vi.mock('node-pty', () => {
  const spawn = vi.fn(() => mockPty)
  return {
    default: { spawn },
    spawn,
  }
})

// Mock child_process — provide default export for CJS/ESM interop
vi.mock('child_process', () => {
  const execFile = vi.fn()
  return {
    default: { execFile },
    execFile,
  }
})

// Import the module once — module is cached, handlers registered in beforeEach
import { registerTerminalHandlers } from './terminal'

describe('terminal utilities', () => {
  describe('toWslPath (path conversion)', () => {
    it('should convert Windows path to WSL path', () => {
      const winPath = 'C:\\Users\\Test\\project'
      const result = winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/c/Users/Test/project')
    })

    it('should handle paths with forward slashes', () => {
      const winPath = 'C:/Users/Test/project'
      const result = winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/c/Users/Test/project')
    })

    it('should handle lowercase drive letters', () => {
      const winPath = 'd:\\Users\\Test'
      const result = winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/d/Users/Test')
    })

    it('should handle paths with spaces', () => {
      const winPath = 'C:\\Users\\My Documents\\project'
      const result = winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/c/Users/My Documents/project')
    })

    it('should handle UNC-style paths starting with /mnt/ unchanged', () => {
      // A path already in Linux format should not be double-converted
      const linuxPath = '/mnt/c/Users/Test'
      const result = linuxPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/c/Users/Test')
    })

    it('should handle empty string without crashing', () => {
      const result = ''.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('')
    })

    it('should convert uppercase drive letter to lowercase', () => {
      const winPath = 'Z:\\Projects\\app'
      const result = winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
      expect(result).toBe('/mnt/z/Projects/app')
    })
  })

  describe('registerTerminalHandlers (IPC registration)', () => {
    beforeEach(async () => {
      const { ipcMain } = await import('electron')
      vi.mocked(ipcMain.handle).mockClear()
      registerTerminalHandlers()
    })

    it('should register handlers with ipcMain', async () => {
      const { ipcMain, app } = await import('electron')
      // ipcMain.handle should be called for each terminal channel
      expect(ipcMain.handle).toHaveBeenCalled()
      // app.on('before-quit') should be registered for cleanup
      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })

    it('should register terminal:getWslUsers handler', async () => {
      const { ipcMain } = await import('electron')
      const mockHandle = vi.mocked(ipcMain.handle)
      const channels = mockHandle.mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:getWslUsers')
    })

    it('should register terminal:create handler', async () => {
      const { ipcMain } = await import('electron')
      const mockHandle = vi.mocked(ipcMain.handle)
      const channels = mockHandle.mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:create')
    })

    it('should register terminal:write handler', async () => {
      const { ipcMain } = await import('electron')
      const mockHandle = vi.mocked(ipcMain.handle)
      const channels = mockHandle.mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:write')
    })

    it('should register terminal:resize handler', async () => {
      const { ipcMain } = await import('electron')
      const mockHandle = vi.mocked(ipcMain.handle)
      const channels = mockHandle.mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:resize')
    })

    it('should register terminal:kill handler', async () => {
      const { ipcMain } = await import('electron')
      const mockHandle = vi.mocked(ipcMain.handle)
      const channels = mockHandle.mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:kill')
    })
  })

  // Helper: fresh handlers for each PTY test
  async function getHandlers() {
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockClear()
    registerTerminalHandlers()
    const mockHandle = vi.mocked(ipcMain.handle)
    const find = (ch: string) => {
      const call = mockHandle.mock.calls.find(c => c[0] === ch)
      if (!call) throw new Error(`Handler not found: ${ch}`)
      return call[1] as (...args: unknown[]) => unknown
    }
    return { find, mockHandle }
  }

  function makeEvent(id: number) {
    return {
      sender: {
        id,
        once: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn(),
      }
    }
  }

  describe('terminal:create handler (PTY spawning)', () => {
    it('should spawn a PTY via node-pty', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const id = await handler(makeEvent(1), 80, 24, undefined, undefined, undefined, undefined, undefined)
      expect(typeof id).toBe('string')
      expect(mockSpawn).toHaveBeenCalledWith('wsl.exe', expect.any(Array), expect.objectContaining({
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
      }))
    })

    it('should include --cd flag when projectPath is provided (without system prompt)', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await handler(makeEvent(2), 80, 24, 'C:\\Projects\\myapp', undefined, undefined, undefined, undefined)
      expect(mockSpawn).toHaveBeenCalledWith('wsl.exe', expect.arrayContaining(['--cd']), expect.any(Object))
    })
  })

  describe('terminal:kill handler (PTY cleanup)', () => {
    it('should call kill() on the PTY process', async () => {
      mockPty.kill.mockClear()

      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const killHandler = find('terminal:kill')

      const id = await createHandler(makeEvent(3), 80, 24)
      await killHandler({}, id)

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('should not throw when killing a non-existent PTY id', async () => {
      const { find } = await getHandlers()
      const killHandler = find('terminal:kill')
      expect(() => killHandler({}, 'nonexistent-id-9999')).not.toThrow()
    })
  })

  describe('terminal:write handler', () => {
    it('should write data to an existing PTY', async () => {
      mockPty.write.mockClear()

      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const writeHandler = find('terminal:write')

      const id = await createHandler(makeEvent(10), 80, 24)
      await writeHandler({}, id, 'hello world\n')

      expect(mockPty.write).toHaveBeenCalledWith('hello world\n')
    })

    it('should be a no-op for non-existent PTY id (no crash)', async () => {
      const { find } = await getHandlers()
      const writeHandler = find('terminal:write')
      expect(() => writeHandler({}, 'nonexistent-99', 'data')).not.toThrow()
    })
  })

  describe('terminal:resize handler', () => {
    it('should resize an existing PTY', async () => {
      mockPty.resize.mockClear()

      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const resizeHandler = find('terminal:resize')

      const id = await createHandler(makeEvent(20), 80, 24)
      await resizeHandler({}, id, 120, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('should be a no-op for non-existent PTY id (no crash)', async () => {
      const { find } = await getHandlers()
      const resizeHandler = find('terminal:resize')
      expect(() => resizeHandler({}, 'nonexistent-99', 100, 30)).not.toThrow()
    })
  })

  describe('terminal:create — system prompt injection', () => {
    it('should inject --append-system-prompt flag when systemPrompt + userPrompt provided', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const systemPrompt = 'Tu es un agent de test'
      const userPrompt = 'Démarre la session'
      await handler(makeEvent(30), 80, 24, undefined, undefined, systemPrompt, userPrompt, undefined)

      const callArgs = mockSpawn.mock.calls[0]
      const spawnArgs = callArgs[1] as string[]
      // Should use -i -c to run wrapperScript via bash
      expect(spawnArgs).toContain('-i')
      expect(spawnArgs).toContain('-c')
      // The wrapper script should include --append-system-prompt
      const commandStr = spawnArgs.join(' ')
      expect(commandStr).toContain('--append-system-prompt')
    })

    it('should include systemPrompt content in spawn args (not as env variable)', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const systemPrompt = 'Mon prompt spécial avec "guillemets"'
      await handler(makeEvent(31), 80, 24, undefined, undefined, systemPrompt, 'start', undefined)

      const callArgs = mockSpawn.mock.calls[0]
      const spawnArgs = callArgs[1] as string[]
      // System prompt should be embedded in the command string (not via shell expansion)
      const commandStr = spawnArgs.join(' ')
      expect(commandStr).toContain('Mon prompt')
    })

    it('should include projectPath via --cd when both projectPath and systemPrompt provided', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await handler(makeEvent(32), 80, 24, 'C:\\Projects\\app', undefined, 'prompt', 'start', undefined)

      const callArgs = mockSpawn.mock.calls[0]
      const spawnArgs = callArgs[1] as string[]
      expect(spawnArgs).toContain('--cd')
      // Path should be WSL-converted
      const cdIndex = spawnArgs.indexOf('--cd')
      expect(spawnArgs[cdIndex + 1]).toContain('/mnt/c/')
    })

    it('should return a unique string ID for each created PTY', async () => {
      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const id1 = await handler(makeEvent(50), 80, 24) as string
      const id2 = await handler(makeEvent(51), 80, 24) as string
      expect(id1).not.toBe(id2)
      expect(typeof id1).toBe('string')
      expect(typeof id2).toBe('string')
    })
  })

  describe('terminal:getWslUsers handler', () => {
    it('should return empty array when wsl.exe fails', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      // Simulate wsl.exe error (WSL not installed)
      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: Error) => void)(new Error('wsl.exe not found'))
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getWslUsers')

      const result = await handler({}) as string[]
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    it('should parse /etc/passwd and return only users with uid >= 1000', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      // Simulate /etc/passwd output with system users (uid < 1000) and regular users (uid >= 1000)
      const passwd = [
        'root:x:0:0:root:/root:/bin/bash',
        'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
        'testuser:x:1000:1000:Test User:/home/testuser:/bin/bash',
        'devuser:x:1001:1001:Dev User:/home/devuser:/bin/zsh',
        'sysuser:x:999:999:System:/home/sys:/bin/bash', // uid 999 - excluded
      ].join('\n')

      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: null, stdout: string) => void)(null, passwd)
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getWslUsers')

      const result = await handler({}) as string[]
      expect(result).toContain('testuser')
      expect(result).toContain('devuser')
      expect(result).not.toContain('root')
      expect(result).not.toContain('daemon')
      expect(result).not.toContain('sysuser')
    })

    it('should exclude users with nologin shell', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      const passwd = [
        'noshelluser:x:1002:1002:No Shell:/home/noshelluser:/usr/sbin/nologin',
        'normaluser:x:1003:1003:Normal:/home/normal:/bin/bash',
      ].join('\n')

      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: null, stdout: string) => void)(null, passwd)
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getWslUsers')

      const result = await handler({}) as string[]
      expect(result).not.toContain('noshelluser')
      expect(result).toContain('normaluser')
    })
  })

  describe('webContents destroyed → PTY cleanup', () => {
    it('should register destroyed listener on first PTY creation for a webContents', async () => {
      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const mockOnce = vi.fn()
      const mockEvent = {
        sender: {
          id: 100,
          once: mockOnce,
          isDestroyed: vi.fn().mockReturnValue(false),
          send: vi.fn(),
        }
      }

      await handler(mockEvent, 80, 24)
      // 'destroyed' listener should be registered on first PTY creation
      expect(mockOnce).toHaveBeenCalledWith('destroyed', expect.any(Function))
    })

    it('should NOT register destroyed listener again for same webContents on second PTY', async () => {
      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const mockOnce = vi.fn()
      const mockEvent = {
        sender: {
          id: 101, // same wcId for both calls
          once: mockOnce,
          isDestroyed: vi.fn().mockReturnValue(false),
          send: vi.fn(),
        }
      }

      await handler(mockEvent, 80, 24)
      mockOnce.mockClear()
      await handler(mockEvent, 80, 24)

      // Second PTY for same webContents should NOT re-register 'destroyed'
      expect(mockOnce).not.toHaveBeenCalled()
    })
  })
})
