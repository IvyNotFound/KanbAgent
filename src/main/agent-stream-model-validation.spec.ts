/**
 * Tests for T1945 — modelId and initialMessage validation at the IPC boundary.
 *
 * Verifies that agent:create rejects:
 * - modelId values containing shell metacharacters (command injection vectors)
 * - initialMessage values containing null bytes
 *
 * Valid model ID formats must pass through unchanged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
const mockAppendFileSync = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('fs', () => {
  const fns = {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    appendFileSync: mockAppendFileSync,
  }
  return { default: fns, ...fns }
})

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  default: { writeFile: mockWriteFile },
}))

const senderRegistry = vi.hoisted(() => new Map<number, {
  id: number
  once: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
  webContents: {
    fromId: vi.fn((id: number) => senderRegistry.get(id) ?? null),
  },
}))

const mockStdin = {
  write: vi.fn(),
  writableEnded: false,
  end: vi.fn(),
}

class FakeProc extends EventEmitter {
  stdin = { ...mockStdin }
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 99999
  kill = vi.fn()
}

let mockProc: FakeProc
const mockSpawn = vi.fn(() => mockProc)
const mockExecFile = vi.fn()

vi.mock('child_process', () => {
  const spawnFn = (...args: unknown[]) => mockSpawn(...args)
  const execFileFn = (...args: unknown[]) => mockExecFile(...args)
  return {
    default: { spawn: spawnFn, execFile: execFileFn },
    spawn: spawnFn,
    execFile: execFileFn,
  }
})

const mockQueryLive = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockAssertDbPathAllowed = vi.hoisted(() => vi.fn())
const mockWriteDb = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./db', () => ({
  queryLive: mockQueryLive,
  writeDb: mockWriteDb,
  assertDbPathAllowed: mockAssertDbPathAllowed,
  registerDbPath: vi.fn(),
  registerProjectPath: vi.fn(),
}))

vi.mock('./hookServer', () => ({
  resolvePermission: vi.fn().mockReturnValue(true),
  pendingPermissions: new Map(),
  startHookServer: vi.fn(),
  setHookWindow: vi.fn(),
  HOOK_PORT: 27182,
}))

const mockCreateWorktree = vi.hoisted(() => vi.fn().mockResolvedValue({ path: '/tmp/wt/branch-1', branch: 'session-1' }))
const mockRemoveWorktree = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./worktree-manager', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree,
  copyWorktreeConfigs: vi.fn().mockResolvedValue(undefined),
}))

// ── Test setup ────────────────────────────────────────────────────────────────

import * as agentStream from './agent-stream'

describe('agent:create — modelId validation (T1945)', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>
  let mockSender: {
    id: number
    once: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.clearAllMocks()
    mockProc = new FakeProc()

    handlers = new Map()
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    })

    agentStream.registerAgentStreamHandlers()

    mockSender = {
      id: 42,
      once: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      send: vi.fn(),
    }
    senderRegistry.set(42, mockSender)

    const { webContents } = await import('electron')
    vi.mocked(webContents.fromId).mockImplementation((id: number) => senderRegistry.get(id) ?? null)
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const timer of agentStream._testing.streamTimers.values()) {
      clearInterval(timer)
    }
    agentStream._testing.streamBatches.clear()
    agentStream._testing.streamTimers.clear()
    senderRegistry.clear()
    agentStream._testing.agents.clear()
    agentStream._testing.webContentsAgents.clear()
  })

  // ── Valid model IDs — must NOT throw ────────────────────────────────────────

  it.each([
    'claude-opus-4-7',
    'gemini-2.5-flash',
    'gpt-4o',
    'o3-mini',
    'google/gemini-2.0-flash',
    'anthropic.claude-3-5-sonnet-20241022',
    'mistral/mistral-7b-instruct',
    'llama3.2',
    'deepseek-r1-0528',
  ])('accepts valid modelId: %s', async (modelId) => {
    const handler = handlers.get('agent:create')!
    await expect(
      handler({ sender: mockSender }, { cli: 'gemini', modelId })
    ).resolves.not.toThrow()
  })

  // ── Malicious model IDs — must throw ─────────────────────────────────────

  it.each([
    ['shell AND operator', 'foo & calc.exe'],
    ['shell pipe operator', 'foo | bar'],
    ['shell semicolon', 'foo;bar'],
    ['command substitution $(...)', '$(whoami)'],
    ['backtick substitution', '`whoami`'],
    ['redirection operator >', 'foo>bar'],
    ['redirection operator <', 'foo<bar'],
    ['shell variable', '$MODEL'],
    ['parentheses', '(foo)'],
    ['exclamation mark', 'foo!bar'],
    ['at sign', 'foo@bar'],
    ['hash sign', 'foo#bar'],
    ['percent sign', 'foo%bar'],
    ['caret sign', 'foo^bar'],
    ['equals sign', 'foo=bar'],
    ['plus sign', 'foo+bar'],
    ['tilde', 'foo~bar'],
    ['space injection', 'claude --allow-writes'],
    ['newline injection', 'foo\nbar'],
    ['tab injection', 'foo\tbar'],
    ['null byte injection', 'foo\0bar'],
    ['backslash', 'foo\\bar'],
    ['colon', 'foo:bar'],
    ['asterisk', 'foo*bar'],
    ['question mark', 'foo?bar'],
    ['brackets', 'foo[bar]'],
    ['curly braces', 'foo{bar}'],
    ['single quote', "foo'bar"],
    ['double quote', 'foo"bar'],
    ['comma', 'foo,bar'],
  ])('rejects malicious modelId (%s)', async (_label, modelId) => {
    const handler = handlers.get('agent:create')!
    await expect(
      handler({ sender: mockSender }, { cli: 'gemini', modelId })
    ).rejects.toThrow('Invalid model ID format')
  })

  // ── initialMessage null byte rejection ──────────────────────────────────────

  it('rejects initialMessage containing null bytes', async () => {
    const handler = handlers.get('agent:create')!
    await expect(
      handler({ sender: mockSender }, { cli: 'opencode', initialMessage: 'hello\0world' })
    ).rejects.toThrow('initialMessage must not contain null bytes')
  })

  it('accepts initialMessage with shell metacharacters (free-form user text)', async () => {
    const handler = handlers.get('agent:create')!
    // User prompts may legitimately contain shell chars — these are NOT rejected at IPC level
    // (spawn-level protection is handled by T1943)
    await expect(
      handler({ sender: mockSender }, { cli: 'opencode', initialMessage: 'Fix the bug & run tests' })
    ).resolves.not.toThrow()
  })

  // ── DB-resolved invalid modelId — must warn + clear (non-blocking) ──────────

  it('warns and clears invalid modelId resolved from DB without throwing', async () => {
    // Simulate DB returning a malicious model value in agents.preferred_model
    mockQueryLive.mockResolvedValueOnce([{ preferred_model: 'foo & calc.exe' }])

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = handlers.get('agent:create')!

    await expect(
      handler({ sender: mockSender }, { cli: 'gemini', dbPath: '/some/db', sessionId: 1 })
    ).resolves.not.toThrow()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring invalid model ID resolved from DB')
    )
    consoleSpy.mockRestore()
  })
})

// ── MODEL_ID_REGEX unit tests ─────────────────────────────────────────────────

import { MODEL_ID_REGEX } from '../shared/cli-types'

describe('MODEL_ID_REGEX', () => {
  it.each([
    'claude-opus-4-7',
    'gemini-2.5-flash',
    'gpt-4o',
    'o3-mini',
    'google/gemini-2.0-flash',
    'anthropic.claude-3-5-sonnet-20241022',
    'llama3.2',
    'a',
    'ABC123',
  ])('matches valid model ID: %s', (id) => {
    expect(MODEL_ID_REGEX.test(id)).toBe(true)
  })

  it.each([
    '',
    'foo bar',
    'foo&bar',
    'foo|bar',
    'foo;bar',
    '$(cmd)',
    '`cmd`',
    'foo\nbar',
    'foo\0bar',
    'foo\\bar',
    'foo:bar',
    'foo*bar',
    'foo?bar',
    'foo[bar]',
    "foo'bar",
    'foo"bar',
  ])('rejects invalid model ID: %s', (id) => {
    expect(MODEL_ID_REGEX.test(id)).toBe(false)
  })
})
