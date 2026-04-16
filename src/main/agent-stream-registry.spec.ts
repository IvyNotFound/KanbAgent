/**
 * Tests for agent-stream-registry.ts
 * Covers: incrementAgentId, flushStreamBatch, pushStreamEvent, cleanupStreamBatch,
 *         sendTerminalEvent, killAgent, killAllAgents, agents Map, webContentsAgents Map.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

// WebContents registry — keyed by ID
const wcRegistry = vi.hoisted(() => new Map<number, {
  id: number
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}>())

vi.mock('electron', () => ({
  webContents: {
    fromId: vi.fn((id: number) => wcRegistry.get(id) ?? null),
  },
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp'),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}))

vi.mock('./utils/wsl', () => ({
  toWslPath: vi.fn((p: string) => p),
}))

vi.mock('./agent-stream-helpers', () => ({
  UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  MAX_STDERR_BUFFER_SIZE: 65536,
  buildClaudeCmd: vi.fn(() => ({ command: 'claude', args: [] })),
  buildWindowsPS1Script: vi.fn(() => 'script'),
  buildEnv: vi.fn(() => ({})),
  buildWindowsEnv: vi.fn(() => ({})),
  getActiveTasksLine: vi.fn(() => Promise.resolve('')),
}))

vi.mock('fs', () => {
  const fns = {
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
  return { default: fns, ...fns }
})

// ── Import after mocks ─────────────────────────────────────────────────────────

import {
  incrementAgentId,
  flushStreamBatch,
  pushStreamEvent,
  cleanupStreamBatch,
  sendTerminalEvent,
  killAgent,
  killAllAgents,
  agents,
  webContentsAgents,
  streamBatches,
  streamTimers,
  nextAgentId,
} from './agent-stream-registry'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWc(id: number, destroyed = false) {
  const wc = {
    id,
    isDestroyed: vi.fn(() => destroyed),
    send: vi.fn(),
    once: vi.fn(),
  }
  wcRegistry.set(id, wc)
  return wc
}

function cleanupWc(id: number) {
  wcRegistry.delete(id)
}

// ── beforeEach / afterEach ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  // Clear all module-level state between tests
  agents.clear()
  webContentsAgents.clear()
  // Clear stream state
  for (const timer of streamTimers.values()) clearInterval(timer)
  streamTimers.clear()
  streamBatches.clear()
  wcRegistry.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── incrementAgentId ──────────────────────────────────────────────────────────

describe('incrementAgentId', () => {
  it('returns a string', () => {
    const id = incrementAgentId()
    expect(typeof id).toBe('string')
  })

  it('returns sequential IDs on successive calls', () => {
    const id1 = incrementAgentId()
    const id2 = incrementAgentId()
    expect(Number(id2)).toBe(Number(id1) + 1)
  })

  it('returns unique IDs across multiple calls', () => {
    const ids = [incrementAgentId(), incrementAgentId(), incrementAgentId()]
    const unique = new Set(ids)
    expect(unique.size).toBe(3)
  })

  it('returns numeric-parseable strings', () => {
    const id = incrementAgentId()
    expect(Number.isInteger(Number(id))).toBe(true)
  })
})

// ── flushStreamBatch ──────────────────────────────────────────────────────────

describe('flushStreamBatch', () => {
  it('does nothing when no batch exists for that id', () => {
    const wc = makeWc(1)
    flushStreamBatch('nonexistent', 1)
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('does nothing when batch is empty', () => {
    const wc = makeWc(2)
    streamBatches.set('a1', [])
    flushStreamBatch('a1', 2)
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('sends the batch to the correct WebContents channel and empties it', () => {
    const wc = makeWc(3)
    const event = { type: 'text', text: 'hello' }
    streamBatches.set('a2', [event])
    flushStreamBatch('a2', 3)
    expect(wc.send).toHaveBeenCalledOnce()
    expect(wc.send).toHaveBeenCalledWith('agent:stream:a2', [event])
    expect(streamBatches.get('a2')).toHaveLength(0)
  })

  it('does not crash when WebContents is destroyed', () => {
    makeWc(4, true) // destroyed = true
    streamBatches.set('a3', [{ type: 'text' }])
    expect(() => flushStreamBatch('a3', 4)).not.toThrow()
    // batch is spliced even when wc is destroyed
    expect(streamBatches.get('a3')).toHaveLength(0)
  })

  it('does not crash when WebContents id is unknown (returns null)', () => {
    // wcRegistry has no entry for id 99
    streamBatches.set('a4', [{ type: 'text' }])
    expect(() => flushStreamBatch('a4', 99)).not.toThrow()
    expect(streamBatches.get('a4')).toHaveLength(0)
  })

  it('sends multiple events in a single call', () => {
    const wc = makeWc(5)
    const events = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]
    streamBatches.set('a5', [...events])
    flushStreamBatch('a5', 5)
    const [, sentBatch] = wc.send.mock.calls[0]
    expect(sentBatch).toHaveLength(2)
  })
})

// ── pushStreamEvent ───────────────────────────────────────────────────────────

describe('pushStreamEvent', () => {
  it('accumulates events in a batch', () => {
    makeWc(10)
    const event = { type: 'text', text: 'hi' }
    pushStreamEvent('b1', 10, event)
    expect(streamBatches.get('b1')).toHaveLength(1)
    expect(streamBatches.get('b1')![0]).toBe(event)
  })

  it('creates a timer on first push', () => {
    makeWc(11)
    pushStreamEvent('b2', 11, { type: 'text' })
    expect(streamTimers.has('b2')).toBe(true)
  })

  it('does not create a second timer on subsequent pushes', () => {
    makeWc(12)
    pushStreamEvent('b3', 12, { type: 'text' })
    pushStreamEvent('b3', 12, { type: 'text' })
    // Only one timer entry
    expect(streamTimers.has('b3')).toBe(true)
    const timerCount = [...streamTimers.keys()].filter(k => k === 'b3').length
    expect(timerCount).toBe(1)
  })

  it('auto-flushes after STREAM_BATCH_INTERVAL_MS via timer', () => {
    const wc = makeWc(13)
    pushStreamEvent('b4', 13, { type: 'text', text: 'tick' })
    expect(wc.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(32)
    expect(wc.send).toHaveBeenCalled()
  })

  it('flushes immediately when batch reaches STREAM_MAX_BATCH_SIZE (100)', () => {
    const wc = makeWc(14)
    // Push 99 events — no immediate flush yet
    for (let i = 0; i < 99; i++) {
      pushStreamEvent('b5', 14, { type: 'text', text: String(i) })
    }
    expect(wc.send).not.toHaveBeenCalled()
    // 100th event triggers overflow flush
    pushStreamEvent('b5', 14, { type: 'text', text: '99' })
    expect(wc.send).toHaveBeenCalled()
  })

  it('overflow flush sends all 100 events at once', () => {
    const wc = makeWc(15)
    for (let i = 0; i < 100; i++) {
      pushStreamEvent('b6', 15, { type: 'text', text: String(i) })
    }
    const [, sentBatch] = wc.send.mock.calls[0]
    expect(sentBatch).toHaveLength(100)
  })
})

// ── cleanupStreamBatch ────────────────────────────────────────────────────────

describe('cleanupStreamBatch', () => {
  it('flushes remaining events before cleanup', () => {
    const wc = makeWc(20)
    streamBatches.set('c1', [{ type: 'text', text: 'last' }])
    const timer = setInterval(() => {}, 1000)
    streamTimers.set('c1', timer)
    cleanupStreamBatch('c1', 20)
    expect(wc.send).toHaveBeenCalledWith('agent:stream:c1', [{ type: 'text', text: 'last' }])
  })

  it('removes the timer', () => {
    makeWc(21)
    pushStreamEvent('c2', 21, { type: 'text' })
    expect(streamTimers.has('c2')).toBe(true)
    cleanupStreamBatch('c2', 21)
    expect(streamTimers.has('c2')).toBe(false)
  })

  it('removes the batch', () => {
    makeWc(22)
    pushStreamEvent('c3', 22, { type: 'text' })
    expect(streamBatches.has('c3')).toBe(true)
    cleanupStreamBatch('c3', 22)
    expect(streamBatches.has('c3')).toBe(false)
  })

  it('does not throw when called on an id with no state', () => {
    expect(() => cleanupStreamBatch('unknown', 999)).not.toThrow()
  })
})

// ── sendTerminalEvent ─────────────────────────────────────────────────────────

describe('sendTerminalEvent', () => {
  it('sends the event wrapped in an array to the correct channel', () => {
    const wc = makeWc(30)
    const event = { type: 'exit', code: 0 }
    sendTerminalEvent('d1', 30, event)
    expect(wc.send).toHaveBeenCalledWith('agent:stream:d1', [event])
  })

  it('cleans up batch and timer before sending', () => {
    const wc = makeWc(31)
    // Set up a pending batch with one event
    streamBatches.set('d2', [{ type: 'text', text: 'pending' }])
    const timer = setInterval(() => {}, 1000)
    streamTimers.set('d2', timer)
    sendTerminalEvent('d2', 31, { type: 'exit', code: 0 })
    // Timer and batch removed
    expect(streamTimers.has('d2')).toBe(false)
    expect(streamBatches.has('d2')).toBe(false)
    // wc.send called twice: once for flush of pending, once for terminal event
    expect(wc.send).toHaveBeenCalledTimes(2)
  })

  it('does not crash when WebContents is destroyed', () => {
    makeWc(32, true)
    expect(() => sendTerminalEvent('d3', 32, { type: 'exit' })).not.toThrow()
  })
})

// ── killAgent ─────────────────────────────────────────────────────────────────

describe('killAgent', () => {
  it('does nothing for an unknown agent id', () => {
    expect(() => killAgent('unknown-id')).not.toThrow()
  })

  it('calls kill() on the stored process', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn()
    proc.pid = 12345
    agents.set('e1', proc)
    killAgent('e1')
    expect(proc.kill).toHaveBeenCalled()
  })

  it('removes the agent from the registry', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn()
    proc.pid = 12346
    agents.set('e2', proc)
    killAgent('e2')
    expect(agents.has('e2')).toBe(false)
  })

  it('clears the stream timer to prevent leaks', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn()
    proc.pid = 12347
    agents.set('e3', proc)
    makeWc(40)
    pushStreamEvent('e3', 40, { type: 'text' })
    expect(streamTimers.has('e3')).toBe(true)
    killAgent('e3')
    expect(streamTimers.has('e3')).toBe(false)
  })

  it('clears the stream batch', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn()
    proc.pid = 12348
    agents.set('e4', proc)
    streamBatches.set('e4', [{ type: 'text' }])
    killAgent('e4')
    expect(streamBatches.has('e4')).toBe(false)
  })

  it('does not throw even if proc.kill() throws', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn(() => { throw new Error('already dead') })
    proc.pid = 12349
    agents.set('e5', proc)
    expect(() => killAgent('e5')).not.toThrow()
  })
})

// ── killAllAgents ─────────────────────────────────────────────────────────────

describe('killAllAgents', () => {
  it('kills all registered agents', () => {
    const procs = ['f1', 'f2', 'f3'].map((id) => {
      const proc = new EventEmitter() as any
      proc.kill = vi.fn()
      proc.pid = 20000 + Number(id.slice(1))
      agents.set(id, proc)
      return proc
    })
    killAllAgents()
    procs.forEach((p) => expect(p.kill).toHaveBeenCalled())
    expect(agents.size).toBe(0)
  })

  it('clears webContentsAgents map', () => {
    webContentsAgents.set(1, new Set(['f4']))
    killAllAgents()
    expect(webContentsAgents.size).toBe(0)
  })

  it('does not throw when agents map is empty', () => {
    expect(() => killAllAgents()).not.toThrow()
  })
})

// ── agents Map ────────────────────────────────────────────────────────────────

describe('agents Map', () => {
  it('supports add, has, and delete operations', () => {
    const proc = new EventEmitter() as any
    proc.kill = vi.fn()
    const id = 'g1'
    expect(agents.has(id)).toBe(false)
    agents.set(id, proc)
    expect(agents.has(id)).toBe(true)
    agents.delete(id)
    expect(agents.has(id)).toBe(false)
  })

  it('stores multiple agents independently', () => {
    const p1 = new EventEmitter() as any
    const p2 = new EventEmitter() as any
    p1.kill = vi.fn(); p2.kill = vi.fn()
    agents.set('g2', p1)
    agents.set('g3', p2)
    expect(agents.get('g2')).toBe(p1)
    expect(agents.get('g3')).toBe(p2)
    expect(agents.size).toBe(2)
  })
})

// ── webContentsAgents Map ─────────────────────────────────────────────────────

describe('webContentsAgents Map', () => {
  it('can associate agent IDs with a WebContents ID', () => {
    const wcId = 50
    const agentSet = new Set(['h1', 'h2'])
    webContentsAgents.set(wcId, agentSet)
    expect(webContentsAgents.get(wcId)).toBe(agentSet)
    expect(webContentsAgents.get(wcId)!.has('h1')).toBe(true)
  })

  it('cleanup removes agent IDs for a given WebContents', () => {
    const wcId = 51
    webContentsAgents.set(wcId, new Set(['h3', 'h4']))
    // Simulate renderer destroy: remove the entry
    webContentsAgents.delete(wcId)
    expect(webContentsAgents.has(wcId)).toBe(false)
  })

  it('different WebContents have independent agent sets', () => {
    webContentsAgents.set(60, new Set(['i1']))
    webContentsAgents.set(61, new Set(['i2']))
    expect(webContentsAgents.get(60)!.has('i1')).toBe(true)
    expect(webContentsAgents.get(61)!.has('i1')).toBe(false)
    expect(webContentsAgents.get(61)!.has('i2')).toBe(true)
  })
})
