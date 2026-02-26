import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import util from 'util'

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
const mockDispose = vi.fn()
const mockPty = {
  onData: vi.fn().mockReturnValue({ dispose: mockDispose }),
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
// Add util.promisify.custom so promisify(execFile) returns { stdout, stderr }
vi.mock('child_process', () => {
  const execFile = vi.fn()
  // promisify.custom makes promisify(execFile) call this instead of the raw fn
  ;(execFile as Record<symbol, unknown>)[util.promisify.custom] = (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      execFile(...args, (err: Error | null, stdout?: string, stderr?: string) => {
        if (err) reject(err)
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
  }
  return {
    default: { execFile },
    execFile,
  }
})

// Mock fs/promises for temp script file (T278)
const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)
vi.mock('fs/promises', () => {
  const writeFile = (...args: unknown[]) => mockWriteFile(...args)
  const unlink = (...args: unknown[]) => mockUnlink(...args)
  return {
    default: { writeFile, unlink },
    writeFile,
    unlink,
  }
})

// Import the module once — module is cached, handlers registered in beforeEach
import { registerTerminalHandlers, _testing } from './terminal'

describe('terminal utilities', () => {
  describe('toWslPath (path conversion)', () => {
    const { toWslPath } = _testing

    it('should convert Windows path to WSL path', () => {
      expect(toWslPath('C:\\Users\\Test\\project')).toBe('/mnt/c/Users/Test/project')
    })

    it('should handle paths with forward slashes', () => {
      expect(toWslPath('C:/Users/Test/project')).toBe('/mnt/c/Users/Test/project')
    })

    it('should handle lowercase drive letters', () => {
      expect(toWslPath('d:\\Users\\Test')).toBe('/mnt/d/Users/Test')
    })

    it('should handle paths with spaces', () => {
      expect(toWslPath('C:\\Users\\My Documents\\project')).toBe('/mnt/c/Users/My Documents/project')
    })

    it('should handle UNC-style paths starting with /mnt/ unchanged', () => {
      expect(toWslPath('/mnt/c/Users/Test')).toBe('/mnt/c/Users/Test')
    })

    it('should handle empty string without crashing', () => {
      expect(toWslPath('')).toBe('')
    })

    it('should convert uppercase drive letter to lowercase', () => {
      expect(toWslPath('Z:\\Projects\\app')).toBe('/mnt/z/Projects/app')
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

      const evt = makeEvent(3)
      const id = await createHandler(evt, 80, 24)
      await killHandler(evt, id)

      expect(mockPty.kill).toHaveBeenCalled()
    })

    it('T532: should throw PTY ownership denied when sender does not own the PTY', async () => {
      const { find } = await getHandlers()
      const killHandler = find('terminal:kill')
      expect(() => killHandler(makeEvent(9999), 'nonexistent-id-9999')).toThrow('PTY ownership denied')
    })
  })

  describe('terminal:write handler', () => {
    it('should write data to an existing PTY', async () => {
      mockPty.write.mockClear()

      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const writeHandler = find('terminal:write')

      const evt = makeEvent(10)
      const id = await createHandler(evt, 80, 24)
      await writeHandler(evt, id, 'hello world\n')

      expect(mockPty.write).toHaveBeenCalledWith('hello world\n')
    })

    it('T532: should throw PTY ownership denied when sender does not own the PTY', async () => {
      const { find } = await getHandlers()
      const writeHandler = find('terminal:write')
      expect(() => writeHandler(makeEvent(9998), 'nonexistent-99', 'data')).toThrow('PTY ownership denied')
    })
  })

  describe('terminal:resize handler', () => {
    it('should resize an existing PTY', async () => {
      mockPty.resize.mockClear()

      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const resizeHandler = find('terminal:resize')

      const evt = makeEvent(20)
      const id = await createHandler(evt, 80, 24)
      await resizeHandler(evt, id, 120, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('T532: should throw PTY ownership denied when sender does not own the PTY', async () => {
      const { find } = await getHandlers()
      const resizeHandler = find('terminal:resize')
      expect(() => resizeHandler(makeEvent(9997), 'nonexistent-99', 100, 30)).toThrow('PTY ownership denied')
    })
  })

  describe('terminal:create — system prompt injection', () => {
    it('should write temp script and use bash -l when systemPrompt + userPrompt provided', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()
      mockWriteFile.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const systemPrompt = 'Tu es un agent de test'
      const userPrompt = 'Démarre la session'
      await handler(makeEvent(30), 80, 24, undefined, undefined, systemPrompt, userPrompt, undefined)

      // Should write a temp script file with --append-system-prompt
      expect(mockWriteFile).toHaveBeenCalledOnce()
      const [, scriptContent] = mockWriteFile.mock.calls[0]
      expect(scriptContent).toContain('--append-system-prompt')
      expect(scriptContent).toContain('base64 -d')

      const callArgs = mockSpawn.mock.calls[0]
      const spawnArgs = callArgs[1] as string[]
      // Should use -- bash -l <script_path> (no -lc inline command)
      expect(spawnArgs).toContain('--')
      expect(spawnArgs).toContain('bash')
      expect(spawnArgs).toContain('-l')
      expect(spawnArgs).not.toContain('-lc')
    })

    it('should include base64-encoded systemPrompt in temp script file', async () => {
      mockWriteFile.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const systemPrompt = 'Mon prompt spécial avec "guillemets"'
      await handler(makeEvent(31), 80, 24, undefined, undefined, systemPrompt, 'start', undefined)

      // The temp script should contain the base64-encoded system prompt
      expect(mockWriteFile).toHaveBeenCalledOnce()
      const [scriptPath, scriptContent] = mockWriteFile.mock.calls[0]
      const expectedB64 = Buffer.from(systemPrompt).toString('base64')
      expect(scriptContent).toContain(expectedB64)
      expect(scriptContent).toContain('base64 -d')
      // Script path should be a temp file
      expect(scriptPath).toContain('agent-prompt-')
      expect(scriptPath).toMatch(/\.sh$/)
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

    it('should pass userPrompt as CLI positional arg in temp script (not via PTY write)', async () => {
      mockWriteFile.mockClear()
      mockPty.write.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await handler(makeEvent(33), 80, 24, undefined, undefined, 'prompt', 'Bonjour agent', undefined)

      // userPrompt is base64-encoded in the temp script file, NOT sent via pty.write
      expect(mockWriteFile).toHaveBeenCalledOnce()
      const [, scriptContent] = mockWriteFile.mock.calls[0]
      const b64User = Buffer.from('Bonjour agent').toString('base64')
      expect(scriptContent).toContain(b64User)

      // pty.write should NOT have been called with the user prompt
      expect(mockPty.write).not.toHaveBeenCalledWith('Bonjour agent\r')
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

  // ── T248: terminal:getClaudeProfiles handler ────────────────────────────────

  describe('terminal:getClaudeProfiles handler', () => {
    it('should return [claude] when ~/bin/ is empty (no wslUser)', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      // execPromise calls promisify(execFile) — mock the callback version
      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: null, stdout: string) => void)(null, '')
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeProfiles')

      const result = await handler({}) as string[]
      expect(result).toContain('claude')
      expect(result[0]).toBe('claude')
    })

    it('should use -u <user> args when wslUser is provided', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      let capturedArgs: string[] = []
      mockExecFile.mockImplementation((_cmd, args, callback) => {
        capturedArgs = args as string[]
        ;(callback as (err: null, stdout: string) => void)(null, '')
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeProfiles')

      await handler({}, 'myuser') as string[]
      expect(capturedArgs).toContain('-u')
      expect(capturedArgs).toContain('myuser')
    })

    it('should parse claude/claude-pro/claude-dev from stdout, sorted with claude first', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: null, stdout: string) => void)(null, 'claude-pro\nclaude-dev\nclaude\n')
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeProfiles')

      const result = await handler({}) as string[]
      expect(result[0]).toBe('claude')
      expect(result).toContain('claude-dev')
      expect(result).toContain('claude-pro')
    })

    it('should filter out invalid scripts (not matching claude pattern)', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: null, stdout: string) => void)(null, 'claude\nrm-rf\nnotclaude\nclaude-dev\n')
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeProfiles')

      const result = await handler({}) as string[]
      expect(result).toContain('claude')
      expect(result).toContain('claude-dev')
      expect(result).not.toContain('rm-rf')
      expect(result).not.toContain('notclaude')
    })

    it('should return [claude] as fallback when execPromise throws', async () => {
      const { execFile } = await import('child_process')
      const mockExecFile = vi.mocked(execFile)

      mockExecFile.mockImplementation((_cmd, _args, callback) => {
        ;(callback as (err: Error) => void)(new Error('ls: cannot access'))
        return {} as ReturnType<typeof execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeProfiles')

      const result = await handler({}) as string[]
      expect(result).toEqual(['claude'])
    })
  })

  // ── T248: terminal:create — claudeCommand + convId validation ──────────────

  describe('terminal:create — claudeCommand validation', () => {
    it('should accept valid claudeCommand (claude)', async () => {
      const nodePty = await import('node-pty')
      vi.mocked(nodePty.spawn).mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      // terminal:create(event, cols, rows, projectPath, wslDistro, systemPrompt, userPrompt, thinkingMode, claudeCommand, convId)
      await expect(handler(makeEvent(60), 80, 24, undefined, undefined, undefined, undefined, undefined, 'claude', undefined)).resolves.not.toThrow()
    })

    it('should throw on invalid claudeCommand (rm -rf)', async () => {
      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await expect(
        handler(makeEvent(61), 80, 24, undefined, undefined, undefined, undefined, undefined, 'rm -rf', undefined)
      ).rejects.toThrow('Invalid claudeCommand')
    })

    it('should accept claude-pro as valid claudeCommand', async () => {
      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await expect(
        handler(makeEvent(62), 80, 24, undefined, undefined, undefined, undefined, undefined, 'claude-pro', undefined)
      ).resolves.not.toThrow()
    })
  })

  describe('terminal:create — convId validation', () => {
    it('should use --resume with valid UUID convId', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()
      mockWriteFile.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const validUuid = '550e8400-e29b-41d4-a716-446655440000'
      await handler(makeEvent(63), 80, 24, undefined, undefined, undefined, undefined, undefined, undefined, validUuid)

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs.join(' ')).toContain('--resume')
      expect(spawnArgs.join(' ')).toContain(validUuid)
    })

    it('should ignore invalid convId (not UUID)', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await handler(makeEvent(64), 80, 24, undefined, undefined, undefined, undefined, undefined, undefined, 'not-a-uuid')

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs.join(' ')).not.toContain('--resume')
    })

    it('should use claudeCommand in --resume mode when both provided', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const validUuid = '550e8400-e29b-41d4-a716-446655440000'
      await handler(makeEvent(65), 80, 24, undefined, undefined, undefined, undefined, undefined, 'claude-dev', validUuid)

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      const fullCmd = spawnArgs.join(' ')
      expect(fullCmd).toContain('claude-dev')
      expect(fullCmd).toContain('--resume')
      expect(fullCmd).toContain(validUuid)
    })

    it('should default to claude when claudeCommand is null/undefined', async () => {
      const nodePty = await import('node-pty')
      const mockSpawn = vi.mocked(nodePty.spawn)
      mockSpawn.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      const validUuid = '550e8400-e29b-41d4-a716-446655440000'
      await handler(makeEvent(66), 80, 24, undefined, undefined, undefined, undefined, undefined, undefined, validUuid)

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      const fullCmd = spawnArgs.join(' ')
      expect(fullCmd).toContain('exec claude --resume')
    })
  })

  // ── T350: userPrompt passed as CLI arg, not PTY write ─────────────────────

  describe('terminal:create — userPrompt as CLI arg (replaces quiet-period)', () => {
    it('should NOT write userPrompt to PTY — it is now a CLI positional arg', async () => {
      mockPty.write.mockClear()
      mockWriteFile.mockClear()

      const { find } = await getHandlers()
      const handler = find('terminal:create')

      await handler(makeEvent(70), 80, 24, undefined, undefined, 'prompt', 'Reset test', undefined)

      // userPrompt is baked into the temp script as a base64-decoded CLI arg
      expect(mockWriteFile).toHaveBeenCalledOnce()
      const [, scriptContent] = mockWriteFile.mock.calls[0]
      expect(scriptContent).toContain(Buffer.from('Reset test').toString('base64'))

      // pty.write should NOT be called with the user prompt at any point
      const writeCalls = mockPty.write.mock.calls.map((c: unknown[]) => c[0])
      expect(writeCalls).not.toContain('Reset test\r')
    })
  })

  // ── T328: parseFreeMOutput ──────────────────────────────────────────────────

  describe('parseFreeMOutput (T328 — available metric)', () => {
    // Import _testing helpers
    let parseFreeMOutput: typeof import('./terminal')._testing.parseFreeMOutput

    beforeEach(async () => {
      const mod = await import('./terminal')
      parseFreeMOutput = mod._testing.parseFreeMOutput
    })

    it('should use available column for memory pressure (not used)', () => {
      const output = [
        '              total        used        free      shared  buff/cache   available',
        'Mem:           7951        3200        2100          50        2651        4500',
        'Swap:          2048           0        2048',
      ].join('\n')

      const result = parseFreeMOutput(output)

      expect(result).not.toBeNull()
      // usedRatio = (total - available) / total = (7951 - 4500) / 7951 ≈ 0.434
      expect(result!.usedRatio).toBeCloseTo((7951 - 4500) / 7951, 3)
      expect(result!.totalMB).toBe(7951)
      expect(result!.availableMB).toBe(4500)
      expect(result!.usedMB).toBe(7951 - 4500)
    })

    it('should return null when no Mem: line found', () => {
      const output = 'Swap:  2048  0  2048\n'
      expect(parseFreeMOutput(output)).toBeNull()
    })

    it('should return null when total is 0 or NaN', () => {
      const output = 'Mem:   0   0   0   0   0   0\n'
      expect(parseFreeMOutput(output)).toBeNull()
    })

    it('should fallback to used column when available is missing (old free format)', () => {
      // Old format with only 4 columns: total used free shared
      const output = 'Mem:   8000  3000  5000  50\n'
      const result = parseFreeMOutput(output)

      expect(result).not.toBeNull()
      // Fallback: usedRatio = used / total = 3000/8000
      expect(result!.usedRatio).toBeCloseTo(3000 / 8000, 3)
      expect(result!.usedMB).toBe(3000)
      expect(result!.availableMB).toBe(5000) // total - used
    })

    it('should handle lines with varying whitespace', () => {
      const output = 'Mem:     16384   8000   4000    200    4184    7800\n'
      const result = parseFreeMOutput(output)

      expect(result).not.toBeNull()
      expect(result!.totalMB).toBe(16384)
      expect(result!.availableMB).toBe(7800)
      expect(result!.usedRatio).toBeCloseTo((16384 - 7800) / 16384, 3)
    })
  })

  // ── T328: releaseWslMemory ──────────────────────────────────────────────────

  describe('releaseWslMemory (T328)', () => {
    let releaseWslMemory: typeof import('./terminal')._testing.releaseWslMemory
    let testing: typeof import('./terminal')._testing
    let mockExecFile: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const mod = await import('./terminal')
      releaseWslMemory = mod._testing.releaseWslMemory
      testing = mod._testing

      const cp = await import('child_process')
      mockExecFile = vi.mocked(cp.execFile)
    })

    it('should return synced:true, dropped:true when drop_caches is available', async () => {
      testing.dropCachesAvailable = true
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: unknown, callback?: unknown) => {
        // execPromise uses promisify(execFile) — mock the callback version
        if (callback && typeof callback === 'function') {
          (callback as (err: null, stdout: string, stderr: string) => void)(null, '', '')
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const result = await releaseWslMemory()

      expect(result.synced).toBe(true)
      expect(result.dropped).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return synced:true, dropped:false when drop_caches is not available', async () => {
      testing.dropCachesAvailable = false
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: unknown, callback?: unknown) => {
        if (callback && typeof callback === 'function') {
          (callback as (err: null, stdout: string, stderr: string) => void)(null, '', '')
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const result = await releaseWslMemory()

      expect(result.synced).toBe(true)
      expect(result.dropped).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('should return error when sync fails', async () => {
      testing.dropCachesAvailable = true
      mockExecFile.mockImplementation((_cmd: string, _args: string[], opts: unknown, callback?: unknown) => {
        if (callback && typeof callback === 'function') {
          (callback as (err: Error) => void)(new Error('WSL not available'))
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const result = await releaseWslMemory()

      expect(result.synced).toBe(false)
      expect(result.dropped).toBe(false)
      expect(result.error).toContain('sync failed')
    })
  })

  // ── T328: Cooldown logic in doMemoryCheck ───────────────────────────────────

  describe('auto-release cooldown (T328)', () => {
    let testing: typeof import('./terminal')._testing
    let mockExecFile: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const mod = await import('./terminal')
      testing = mod._testing

      const cp = await import('child_process')
      mockExecFile = vi.mocked(cp.execFile)

      // Reset state
      testing.dropCachesAvailable = true
      testing.lastAutoReleaseAt = 0
      testing.memoryCheckRunning = false

      // Add a fake PTY so doMemoryCheck doesn't exit early
      testing.ptys.set('test-cooldown', {} as import('node-pty').IPty)

      // Mock BrowserWindow.getAllWindows to return empty array
      const electron = await import('electron')
      ;(electron as Record<string, unknown>).BrowserWindow = {
        getAllWindows: vi.fn(() => []),
      }
    })

    afterEach(async () => {
      const mod = await import('./terminal')
      mod._testing.ptys.delete('test-cooldown')
    })

    it('should call releaseWslMemory when cooldown has elapsed', async () => {
      // lastAutoReleaseAt = 0 means never released → cooldown elapsed
      testing.lastAutoReleaseAt = 0

      // Mock free -m output with critical memory (available < 15%)
      const criticalFreeOutput = '              total        used        free      shared  buff/cache   available\nMem:           8000        7500         100          50         400         500\n'

      let callCount = 0
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++
        // promisify calls execFile(cmd, args, cb) or execFile(cmd, args, opts, cb)
        // Find the callback — it's always the last argument
        const cb = args[args.length - 1]
        if (typeof cb === 'function') {
          if (callCount === 1) {
            // First call: wsl.exe -- free -m
            cb(null, criticalFreeOutput, '')
          } else {
            // Subsequent calls: sync / drop_caches from releaseWslMemory
            cb(null, '', '')
          }
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      await testing.doMemoryCheck()

      // doMemoryCheck sets lastAutoReleaseAt before calling releaseWslMemory (fire-and-forget)
      // So lastAutoReleaseAt > 0 proves the auto-release was triggered
      expect(testing.lastAutoReleaseAt).toBeGreaterThan(0)
      // free -m call happened + at least releaseWslMemory was invoked
      expect(callCount).toBeGreaterThanOrEqual(1)
    })

    it('should NOT call releaseWslMemory when within 60s cooldown window', async () => {
      // Set lastAutoReleaseAt to "just now" — within cooldown
      testing.lastAutoReleaseAt = Date.now()

      const criticalFreeOutput = '              total        used        free      shared  buff/cache   available\nMem:           8000        7500         100          50         400         500\n'

      let callCount = 0
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1]
        if (typeof cb === 'function') {
          callCount++
          cb(null, criticalFreeOutput, '')
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const previousReleaseAt = testing.lastAutoReleaseAt

      await testing.doMemoryCheck()

      // Only 1 call: free -m. No sync/drop_caches because cooldown not elapsed
      expect(callCount).toBe(1)
      // lastAutoReleaseAt should NOT have changed
      expect(testing.lastAutoReleaseAt).toBe(previousReleaseAt)
    })
  })

  // ── T328: terminal:releaseMemory IPC ────────────────────────────────────────

  describe('terminal:releaseMemory IPC handler (T328)', () => {
    it('should register terminal:releaseMemory handler', async () => {
      const { ipcMain } = await import('electron')
      vi.mocked(ipcMain.handle).mockClear()
      registerTerminalHandlers()

      const channels = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0])
      expect(channels).toContain('terminal:releaseMemory')
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // T350: New tests for terminal.ts — missing handler/logic coverage
  // ══════════════════════════════════════════════════════════════════════════════

  // Helper: get the onData/onExit callback registered by the CURRENT test's terminal:create.
  // We snapshot the call count before each create, so we can pick the exact callback.
  let onDataIndexBefore = 0
  let onExitIndexBefore = 0

  /** Call before terminal:create to snapshot mockPty callback indices */
  function snapshotPtyCallbacks(): void {
    onDataIndexBefore = mockPty.onData.mock.calls.length
    onExitIndexBefore = mockPty.onExit.mock.calls.length
  }

  function lastOnData(): (data: string) => void {
    // Use the first callback registered AFTER the snapshot
    const calls = mockPty.onData.mock.calls
    const idx = onDataIndexBefore < calls.length ? onDataIndexBefore : calls.length - 1
    return calls[idx][0] as (data: string) => void
  }
  function lastOnExit(): (data: { exitCode: number }) => void {
    const calls = mockPty.onExit.mock.calls
    const idx = onExitIndexBefore < calls.length ? onExitIndexBefore : calls.length - 1
    return calls[idx][0] as (data: { exitCode: number }) => void
  }

  // ── terminal:getClaudeInstances ─────────────────────────────────────────────

  describe('terminal:getClaudeInstances handler (T350)', () => {
    let mockExecFile: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const cp = await import('child_process')
      mockExecFile = vi.mocked(cp.execFile)
    })

    it('should parse distros, mark default with *, sort default first', async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') {
          const strArgs = (args || []).join(' ')
          if (strArgs.includes('-l --verbose')) {
            cb(null, '  NAME            STATE           VERSION\n* Ubuntu           Running         2\n  Debian           Running         2\n', '')
          } else if (strArgs.includes('claude --version')) {
            cb(null, '2.1.58 (Claude Code)\n', '')
          } else if (strArgs.includes('ls ~/bin/')) {
            cb(null, 'claude\nclaude-pro\n', '')
          } else {
            cb(null, '', '')
          }
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeInstances')
      const result = await handler({}) as Array<{ distro: string; isDefault: boolean; version: string; profiles: string[] }>

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].isDefault).toBe(true)
      expect(result[0].distro).toBe('Ubuntu')
    })

    it('should filter out docker-desktop distros', async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') {
          const strArgs = (args || []).join(' ')
          if (strArgs.includes('-l --verbose')) {
            cb(null, '  NAME                   STATE  VERSION\n* Ubuntu                  Running  2\n  docker-desktop          Running  2\n  docker-desktop-data     Running  2\n', '')
          } else if (strArgs.includes('claude --version')) {
            cb(null, '2.1.0\n', '')
          } else if (strArgs.includes('ls ~/bin/')) {
            cb(new Error('no dir'), '', '')
          } else {
            cb(null, '', '')
          }
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      const handler = find('terminal:getClaudeInstances')
      const result = await handler({}) as Array<{ distro: string }>

      const distroNames = result.map(r => r.distro)
      expect(distroNames).not.toContain('docker-desktop')
      expect(distroNames).not.toContain('docker-desktop-data')
    })

    it('should return [] when wsl.exe fails', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') cb(new Error('wsl not installed'), '', '')
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      const result = await find('terminal:getClaudeInstances')({})
      expect(result).toEqual([])
    })

    it('should scan ~/bin/ for claude profiles per distro', async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') {
          const strArgs = (args || []).join(' ')
          if (strArgs.includes('-l --verbose')) {
            cb(null, '  NAME  STATE  VERSION\n* Ubuntu  Running  2\n', '')
          } else if (strArgs.includes('claude --version')) {
            cb(null, '2.1.58\n', '')
          } else if (strArgs.includes('ls ~/bin/')) {
            cb(null, 'claude\nclaude-dev\nclaude-pro\nnotclaude\n', '')
          } else {
            cb(null, '', '')
          }
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      const result = await find('terminal:getClaudeInstances')({}) as Array<{ profiles: string[] }>

      expect(result[0].profiles[0]).toBe('claude')
      expect(result[0].profiles).toContain('claude-dev')
      expect(result[0].profiles).toContain('claude-pro')
      expect(result[0].profiles).not.toContain('notclaude')
    })
  })

  // ── terminal:relaunch ───────────────────────────────────────────────────────

  describe('terminal:relaunch handler (T350)', () => {
    it('should return stored params with useResume=true selecting detectedConvId', async () => {
      const { find } = await getHandlers()
      const createHandler = find('terminal:create')
      const relaunchHandler = find('terminal:relaunch')

      const evt = makeEvent(80)
      snapshotPtyCallbacks()
      const id = await createHandler(evt, 80, 24, 'C:\\Projects\\app', undefined, 'prompt', 'start', 'disabled', 'claude-dev', undefined)

      // Simulate conv ID detection via onData
      const onDataCb = lastOnData()
      onDataCb('Session ID: abcd1234-aaaa-bbbb-cccc-ddddeeee1111')

      // T532: relaunch must use the same sender that created the PTY
      const result = await relaunchHandler(evt, id, true) as Record<string, unknown>
      expect(result.cols).toBe(80)
      expect(result.rows).toBe(24)
      expect(result.projectPath).toBe('C:\\Projects\\app')
      expect(result.claudeCommand).toBe('claude-dev')
      expect(result.thinkingMode).toBe('disabled')
      expect(result.convId).toBe('abcd1234-aaaa-bbbb-cccc-ddddeeee1111')
    })

    it('T532: should throw PTY ownership denied when sender does not own the PTY', async () => {
      const { find } = await getHandlers()
      await expect(find('terminal:relaunch')(makeEvent(82), 'nonexistent-9999')).rejects.toThrow('PTY ownership denied')
    })
  })

  // ── terminal:dismissCrash ───────────────────────────────────────────────────

  describe('terminal:dismissCrash handler (T350)', () => {
    it('should delete stored ptyLaunchParams so relaunch fails', async () => {
      const { find } = await getHandlers()
      // Create a PTY — launch params are stored
      const evt = makeEvent(83)
      const id = await find('terminal:create')(evt, 80, 24, 'C:\\p', undefined, 'p', 'u', undefined)

      // Verify relaunch would succeed (params exist)
      // Use a fresh handler set to avoid side effects — but we need the same module state
      // Just check that dismissCrash actually removes the params:
      await find('terminal:dismissCrash')({}, id)

      // T532: relaunch uses same sender; dismissCrash only removes ptyLaunchParams, not ownership
      // So ownership check passes (wcId 83 still owns the PTY id in webContentsPtys)
      // but params are deleted → throws 'No launch params found'
      await expect(find('terminal:relaunch')(evt, id)).rejects.toThrow('No launch params found')
    })
  })

  // ── terminal:getActiveCount / terminal:isAlive ──────────────────────────────

  describe('terminal:getActiveCount handler (T350)', () => {
    it('should return ptys.size (increments after create)', async () => {
      const { find } = await getHandlers()
      const before = await find('terminal:getActiveCount')({}) as number
      await find('terminal:create')(makeEvent(90), 80, 24)
      const after = await find('terminal:getActiveCount')({}) as number
      expect(after).toBeGreaterThan(before)
    })
  })

  describe('terminal:isAlive handler (T350)', () => {
    it('should return true for active PTY, false for unknown id', async () => {
      const { find } = await getHandlers()
      const id = await find('terminal:create')(makeEvent(91), 80, 24)
      expect(await find('terminal:isAlive')({}, id)).toBe(true)
      expect(await find('terminal:isAlive')({}, 'nonexistent-999')).toBe(false)
    })
  })

  // ── terminal:getMemoryStatus ────────────────────────────────────────────────

  describe('terminal:getMemoryStatus handler (T350)', () => {
    it('should return full memory shape on success', async () => {
      const cp = await import('child_process')
      vi.mocked(cp.execFile).mockImplementation((_cmd: string, _args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') {
          cb(null, '              total        used        free      shared  buff/cache   available\nMem:           8000        5000        1000          50        2000        3000\n', '')
        }
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      const result = await find('terminal:getMemoryStatus')({}) as Record<string, unknown>

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('usedMB')
      expect(result).toHaveProperty('totalMB')
      expect(result).toHaveProperty('availableMB')
      expect(result).toHaveProperty('usedRatio')
      expect(result).toHaveProperty('warning')
      expect(result).toHaveProperty('critical')
      expect(result).toHaveProperty('activeSessions')
      expect(result).toHaveProperty('dropCachesAvailable')
      expect(result.totalMB).toBe(8000)
      expect(result.availableMB).toBe(3000)
    })

    it('should return null when wsl.exe fails', async () => {
      const cp = await import('child_process')
      vi.mocked(cp.execFile).mockImplementation((_cmd: string, _args: string[], ...rest: unknown[]) => {
        const cb = rest[rest.length - 1]
        if (typeof cb === 'function') cb(new Error('WSL not available'), '', '')
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      const { find } = await getHandlers()
      expect(await find('terminal:getMemoryStatus')({})).toBeNull()
    })
  })

  // ── gracefulKillPty behavior ────────────────────────────────────────────────

  describe('gracefulKillPty — agent vs plain (T350)', () => {
    it('should send Ctrl+C x2 then exit then kill for agent sessions', async () => {
      vi.useFakeTimers()
      mockPty.write.mockClear()
      mockPty.kill.mockClear()

      const { find } = await getHandlers()
      const evt = makeEvent(100)
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'prompt', 'start', undefined)
      // T532: use the same sender that created the PTY
      await find('terminal:kill')(evt, id)

      expect(mockPty.write).toHaveBeenCalledWith('\x03\x03')
      vi.advanceTimersByTime(110)
      expect(mockPty.write).toHaveBeenCalledWith('exit\r')
      vi.advanceTimersByTime(200)
      expect(mockPty.kill).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should kill immediately for plain bash sessions', async () => {
      mockPty.write.mockClear()
      mockPty.kill.mockClear()

      const { find } = await getHandlers()
      const evt = makeEvent(101)
      const id = await find('terminal:create')(evt, 80, 24, 'C:\\Projects\\app', undefined, undefined, undefined, undefined)
      // T532: use the same sender that created the PTY
      await find('terminal:kill')(evt, id)

      expect(mockPty.write).not.toHaveBeenCalledWith('\x03\x03')
      expect(mockPty.kill).toHaveBeenCalled()
    })
  })

  // ── Conv ID detection ───────────────────────────────────────────────────────

  describe('Conv ID detection in PTY output (T350)', () => {
    it('should emit terminal:convId:<id> on Session ID match', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(110)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'prompt', 'start', undefined)

      const onDataCb = lastOnData()
      onDataCb('Starting Claude Code...\nSession ID: abcd1234-aaaa-bbbb-cccc-ddddeeee1111\n')

      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:convId:${id}`, 'abcd1234-aaaa-bbbb-cccc-ddddeeee1111')
    })

    it('should detect "Conversation ID:" format', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(111)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'p', 'u', undefined)

      ;lastOnData()('Conversation ID: 12345678-1234-1234-1234-123456789abc\n')
      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:convId:${id}`, '12345678-1234-1234-1234-123456789abc')
    })

    it('should detect "Resuming <uuid>" format', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(112)
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, undefined, undefined, undefined, undefined, validUuid)

      ;lastOnData()('Resuming 550e8400-e29b-41d4-a716-446655440000\n')
      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:convId:${id}`, '550e8400-e29b-41d4-a716-446655440000')
    })

    it('should only detect once (idempotent)', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(113)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'p', 'u', undefined)

      const onDataCb = lastOnData()
      onDataCb('Session ID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n')
      onDataCb('Session ID: 11111111-2222-3333-4444-555555555555\n')

      const convIdCalls = (evt.sender.send as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => (c[0] as string).startsWith(`terminal:convId:${id}`))
      expect(convIdCalls).toHaveLength(1)
      expect(convIdCalls[0][1]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    })
  })

  // ── onExit crash detection ──────────────────────────────────────────────────

  describe('onExit crash detection (T350)', () => {
    it('should emit isCrash=true when exitCode !== 0', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(120)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'prompt', 'start', undefined)

      ;lastOnExit()({ exitCode: 137 })

      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:exit:${id}`, expect.objectContaining({
        exitCode: 137, isCrash: true, isAgent: true,
      }))
    })

    it('should emit isCrash=false when exitCode === 0', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(121)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'prompt', 'start', undefined)

      ;lastOnExit()({ exitCode: 0 })

      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:exit:${id}`, expect.objectContaining({
        exitCode: 0, isCrash: false,
      }))
    })

    it('should clean up temp script file on exit', async () => {
      mockUnlink.mockClear()
      const { find } = await getHandlers()
      snapshotPtyCallbacks()
      await find('terminal:create')(makeEvent(122), 80, 24, undefined, undefined, 'prompt', 'start', undefined)

      ;lastOnExit()({ exitCode: 0 })
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('should include canResume=true when detectedConvId exists', async () => {
      const { find } = await getHandlers()
      const evt = makeEvent(123)
      snapshotPtyCallbacks()
      const id = await find('terminal:create')(evt, 80, 24, undefined, undefined, 'p', 'u', undefined)

      ;lastOnData()('Session ID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n')
      ;lastOnExit()({ exitCode: 1 })

      expect(evt.sender.send).toHaveBeenCalledWith(`terminal:exit:${id}`, expect.objectContaining({
        canResume: true, resumeConvId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }))
    })
  })

  // ── T563: onData disposable cleanup on natural exit ─────────────────────────

  describe('pty.onData disposable cleanup on natural exit (T563)', () => {
    it('should call dispose() on the onData listener when PTY exits naturally', async () => {
      mockDispose.mockClear()

      const { find } = await getHandlers()
      const evt = makeEvent(200)
      snapshotPtyCallbacks()
      await find('terminal:create')(evt, 80, 24)

      ;lastOnExit()({ exitCode: 0 })

      expect(mockDispose).toHaveBeenCalled()
    })

    it('should call dispose() on onData listener even on crash exit (exitCode !== 0)', async () => {
      mockDispose.mockClear()

      const { find } = await getHandlers()
      const evt = makeEvent(201)
      snapshotPtyCallbacks()
      await find('terminal:create')(evt, 80, 24, undefined, undefined, 'prompt', 'start', undefined)

      ;lastOnExit()({ exitCode: 137 })

      expect(mockDispose).toHaveBeenCalled()
    })
  })

  // ── terminal:create with wslDistro ──────────────────────────────────────────

  describe('terminal:create — wslDistro arg (T350)', () => {
    it('should pass -d <distro> to wsl.exe when wslDistro is provided', async () => {
      const nodePty = await import('node-pty')
      vi.mocked(nodePty.spawn).mockClear()

      const { find } = await getHandlers()
      await find('terminal:create')(makeEvent(130), 80, 24, undefined, 'Ubuntu', undefined, undefined, undefined)

      const spawnArgs = vi.mocked(nodePty.spawn).mock.calls[0][1] as string[]
      expect(spawnArgs).toContain('-d')
      expect(spawnArgs).toContain('Ubuntu')
    })
  })

  // ── terminal:create thinkingMode disabled ───────────────────────────────────

  describe('terminal:create — thinkingMode disabled (T350)', () => {
    it('should inject --settings in resume mode', async () => {
      const nodePty = await import('node-pty')
      vi.mocked(nodePty.spawn).mockClear()

      const { find } = await getHandlers()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'
      await find('terminal:create')(makeEvent(140), 80, 24, undefined, undefined, undefined, undefined, 'disabled', undefined, validUuid)

      const fullCmd = (vi.mocked(nodePty.spawn).mock.calls[0][1] as string[]).join(' ')
      expect(fullCmd).toContain('alwaysThinkingEnabled')
      expect(fullCmd).toContain('false')
    })

    it('should inject --settings in normal agent launch when disabled', async () => {
      mockWriteFile.mockClear()
      const { find } = await getHandlers()
      await find('terminal:create')(makeEvent(141), 80, 24, undefined, undefined, 'sys prompt', 'start', 'disabled')

      expect(mockWriteFile).toHaveBeenCalledOnce()
      const scriptContent = mockWriteFile.mock.calls[0][1]
      expect(scriptContent).toContain('alwaysThinkingEnabled')
    })

    it('should NOT inject --settings when thinkingMode is auto', async () => {
      mockWriteFile.mockClear()
      const { find } = await getHandlers()
      await find('terminal:create')(makeEvent(142), 80, 24, undefined, undefined, 'sys prompt', 'start', 'auto')

      const scriptContent = mockWriteFile.mock.calls[0][1]
      expect(scriptContent).not.toContain('alwaysThinkingEnabled')
    })
  })

  // ── killAllPtys ─────────────────────────────────────────────────────────────

  describe('killAllPtys via before-quit (T350)', () => {
    it('should kill all active PTYs', async () => {
      mockPty.kill.mockClear()
      const { find } = await getHandlers()
      const { app } = await import('electron')

      await find('terminal:create')(makeEvent(150), 80, 24)
      await find('terminal:create')(makeEvent(151), 80, 24)

      const beforeQuitCall = vi.mocked(app.on).mock.calls.find(c => c[0] === 'before-quit')
      expect(beforeQuitCall).toBeTruthy()
      ;(beforeQuitCall![1] as () => void)()

      expect(mockPty.kill).toHaveBeenCalled()
    })
  })

  // ── checkDropCachesCapability ────────────────────────────────────────────────

  describe('checkDropCachesCapability (T350)', () => {
    let testing: typeof import('./terminal')._testing
    let mockExecFile: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      const mod = await import('./terminal')
      testing = mod._testing
      const cp = await import('child_process')
      mockExecFile = vi.mocked(cp.execFile)
    })

    it('should return true when sudo -n tee succeeds', async () => {
      testing.dropCachesAvailable = null
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1]
        if (typeof cb === 'function') cb(null, '', '')
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      expect(await testing.checkDropCachesCapability()).toBe(true)
      expect(testing.dropCachesAvailable).toBe(true)
    })

    it('should return false when sudo -n tee fails', async () => {
      testing.dropCachesAvailable = null
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1]
        if (typeof cb === 'function') cb(new Error('password required'), '', '')
        return {} as ReturnType<typeof import('child_process').execFile>
      })

      expect(await testing.checkDropCachesCapability()).toBe(false)
      expect(testing.dropCachesAvailable).toBe(false)
    })
  })
})
