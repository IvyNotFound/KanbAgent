/**
 * Tests for cli-model-detect — dynamic CLI model detection (T1806)
 *
 * Strategy: mock fs/promises.readFile and child_process.execFile via hoisting,
 * then test detection functions and caching logic directly.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const { readFileMock, execFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  execFileMock: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: { readFile: readFileMock },
  readFile: readFileMock,
}))

vi.mock('child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}))

vi.mock('util', () => ({
  default: { promisify: () => execFileMock },
  promisify: () => execFileMock,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

// ── Import after mocks ───────────────────────────────────────────────────────
import {
  detectOpenCodeModels,
  detectAiderModels,
  getModelsForCli,
  warmupModelDetection,
  clearModelCache,
  parseAiderOutput,
  _testing,
} from './cli-model-detect'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sample OpenCode models.json content. */
const OPENCODE_CACHE_JSON = JSON.stringify({
  models: [
    {
      id: 'anthropic/claude-sonnet-4-6',
      providerID: 'anthropic',
      name: 'Claude Sonnet 4.6',
      context_length: 200000,
    },
    {
      id: 'openai/gpt-4o',
      providerID: 'openai',
      name: 'GPT-4o',
      context_length: 128000,
    },
  ],
})

/** Sample Aider --list-models output. */
const AIDER_LIST_OUTPUT = `
Aider v0.82.0
- anthropic/claude-sonnet-4-6
- anthropic/claude-opus-4-7
- anthropic/claude-haiku-4-5
`

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseAiderOutput', () => {
  it('extracts model IDs from "- model" lines', () => {
    const models = parseAiderOutput(AIDER_LIST_OUTPUT)
    expect(models).toHaveLength(3)
    expect(models[0]).toEqual({
      id: 'anthropic/claude-sonnet-4-6',
      label: 'anthropic/claude-sonnet-4-6',
      modelId: 'anthropic/claude-sonnet-4-6',
      provider: 'anthropic',
      dynamic: true,
    })
  })

  it('ignores non-model lines', () => {
    const models = parseAiderOutput('Aider v0.82.0\nSome info\n- valid/model\n')
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('valid/model')
  })

  it('returns empty array for empty output', () => {
    expect(parseAiderOutput('')).toEqual([])
  })

  it('extracts provider from slash-separated model ID', () => {
    const models = parseAiderOutput('- openai/gpt-4o\n')
    expect(models[0].provider).toBe('openai')
  })

  it('sets provider undefined when no slash in model ID', () => {
    const models = parseAiderOutput('- gpt-4o\n')
    expect(models[0].provider).toBeUndefined()
  })
})

describe('detectOpenCodeModels', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearModelCache()
  })

  it('reads models from cache file when available', async () => {
    readFileMock.mockResolvedValueOnce(OPENCODE_CACHE_JSON)

    const models = await detectOpenCodeModels()
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual({
      id: 'anthropic/claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      modelId: 'anthropic/claude-sonnet-4-6',
      provider: 'anthropic',
      contextLength: 200000,
      dynamic: true,
    })
    expect(models[1].provider).toBe('openai')
  })

  it('falls back to spawn when cache file not found', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    execFileMock.mockResolvedValueOnce({ stdout: OPENCODE_CACHE_JSON, stderr: '' })

    const models = await detectOpenCodeModels()
    expect(models).toHaveLength(2)
    expect(execFileMock).toHaveBeenCalledWith(
      'opencode',
      ['models'],
      expect.objectContaining({ timeout: 5000 }),
    )
  })

  it('returns empty array when both cache and spawn fail', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    execFileMock.mockRejectedValueOnce(new Error('not found'))

    const models = await detectOpenCodeModels()
    expect(models).toEqual([])
  })

  it('skips entries without an id field', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ models: [{ name: 'no-id' }, { id: 'valid/model', name: 'Valid' }] }),
    )

    const models = await detectOpenCodeModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('valid/model')
  })

  it('handles malformed JSON gracefully', async () => {
    readFileMock.mockResolvedValueOnce('not json')
    execFileMock.mockRejectedValueOnce(new Error('not found'))

    const models = await detectOpenCodeModels()
    expect(models).toEqual([])
  })

  it('uses model id as label when name is missing', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ models: [{ id: 'provider/model' }] }),
    )

    const models = await detectOpenCodeModels()
    expect(models[0].label).toBe('provider/model')
  })
})

describe('detectAiderModels', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearModelCache()
  })

  it('detects models from parallel provider spawns', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '- anthropic/claude-sonnet-4-6\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '- openai/gpt-4o\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '- google/gemini-2.5-pro\n', stderr: '' })

    const models = await detectAiderModels()
    expect(models).toHaveLength(3)
    expect(models.every((m) => m.dynamic === true)).toBe(true)
  })

  it('deduplicates models across providers', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '- anthropic/claude-sonnet-4-6\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '- anthropic/claude-sonnet-4-6\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const models = await detectAiderModels()
    expect(models).toHaveLength(1)
  })

  it('falls back to static list when all spawns fail', async () => {
    execFileMock.mockRejectedValue(new Error('aider not found'))

    const models = await detectAiderModels()
    // Should return the static fallback models
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.dynamic === undefined || m.dynamic === false)).toBe(true)
  })

  it('returns detected models even if some providers fail', async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: '- anthropic/claude-sonnet-4-6\n', stderr: '' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))

    const models = await detectAiderModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6')
  })
})

describe('getModelsForCli — caching', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearModelCache()
  })

  it('returns cached models on second call within TTL', async () => {
    readFileMock.mockResolvedValue(OPENCODE_CACHE_JSON)

    const first = await getModelsForCli('opencode')
    const second = await getModelsForCli('opencode')

    expect(first).toEqual(second)
    // readFile called only once (first call populates cache)
    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache when forceRefresh is true', async () => {
    readFileMock.mockResolvedValue(OPENCODE_CACHE_JSON)

    await getModelsForCli('opencode')
    await getModelsForCli('opencode', true)

    // readFile called twice (cache bypassed on second call)
    expect(readFileMock).toHaveBeenCalledTimes(2)
  })

  it('re-detects after cache TTL expires', async () => {
    readFileMock.mockResolvedValue(OPENCODE_CACHE_JSON)

    await getModelsForCli('opencode')

    // Manually expire the cache
    const entry = _testing.modelCache.get('opencode')
    if (entry) entry.timestamp = Date.now() - _testing.MODEL_CACHE_TTL - 1

    await getModelsForCli('opencode')
    expect(readFileMock).toHaveBeenCalledTimes(2)
  })

  it('returns static models for claude', async () => {
    const models = await getModelsForCli('claude')
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].id).toBe('sonnet')
  })

  it('returns static models for gemini', async () => {
    const models = await getModelsForCli('gemini')
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].id).toBe('gemini-2.5-pro')
  })

  it('returns static models for codex (T1822)', async () => {
    const models = await getModelsForCli('codex')
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].id).toBe('o3')
  })

  it('returns static models for goose (T1822)', async () => {
    const models = await getModelsForCli('goose')
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].id).toBe('gpt-4.1')
  })
})

describe('warmupModelDetection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearModelCache()
  })

  it('pre-warms cache for opencode and aider without throwing', () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    execFileMock.mockRejectedValue(new Error('not found'))

    // Should not throw — fire & forget
    expect(() => warmupModelDetection()).not.toThrow()
  })
})

describe('buildOpenCodeCachePaths', () => {
  it('includes XDG cache path on all platforms', () => {
    const paths = _testing.buildOpenCodeCachePaths()
    expect(paths.some((p) => p.includes('.cache'))).toBe(true)
  })
})
