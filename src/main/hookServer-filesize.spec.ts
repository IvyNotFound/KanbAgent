/**
 * Tests for hookServer-filesize — PostToolUse file-size enforcement (T1898)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkPostToolUseFileSize,
  isFileExcludedFromSizeCheck,
  updateFileSizeConfig,
  getFileSizeConfig,
} from './hookServer-filesize'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a string with the given number of lines. */
function makeContent(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n')
}

function writePayload(filePath: string): Record<string, unknown> {
  return { tool_name: 'Write', tool_input: { file_path: filePath } }
}

function editPayload(filePath: string): Record<string, unknown> {
  return { tool_name: 'Edit', tool_input: { file_path: filePath } }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('hookServer-filesize — updateFileSizeConfig', () => {
  beforeEach(() => {
    updateFileSizeConfig(true, 400)
  })

  it('stores enabled and maxLines', () => {
    updateFileSizeConfig(false, 600)
    const cfg = getFileSizeConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.maxLines).toBe(600)
  })

  it('clamps maxLines to 50–10000', () => {
    updateFileSizeConfig(true, 10)
    expect(getFileSizeConfig().maxLines).toBe(50)

    updateFileSizeConfig(true, 99999)
    expect(getFileSizeConfig().maxLines).toBe(10000)
  })
})

describe('hookServer-filesize — isFileExcludedFromSizeCheck', () => {
  it('excludes .spec.ts files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/foo.spec.ts')).toBe(true)
  })

  it('excludes .test.ts files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/bar.test.ts')).toBe(true)
  })

  it('excludes .spec.tsx files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/Comp.spec.tsx')).toBe(true)
  })

  it('excludes locale JSON under locales/', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/locales/en.json')).toBe(true)
  })

  it('excludes locale JSON under i18n/', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/i18n/fr.json')).toBe(true)
  })

  it('excludes package.json', () => {
    expect(isFileExcludedFromSizeCheck('/project/package.json')).toBe(true)
  })

  it('excludes tsconfig.json', () => {
    expect(isFileExcludedFromSizeCheck('/project/tsconfig.json')).toBe(true)
  })

  it('excludes tsconfig.app.json', () => {
    expect(isFileExcludedFromSizeCheck('/project/tsconfig.app.json')).toBe(true)
  })

  it('excludes *.config.ts files', () => {
    expect(isFileExcludedFromSizeCheck('/project/vite.config.ts')).toBe(true)
  })

  it('excludes .d.ts files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/types/electron.d.ts')).toBe(true)
  })

  it('excludes .md files', () => {
    expect(isFileExcludedFromSizeCheck('/project/CLAUDE.md')).toBe(true)
  })

  it('does NOT exclude regular .ts source files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/main/hookServer.ts')).toBe(false)
  })

  it('does NOT exclude .vue files', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/renderer/App.vue')).toBe(false)
  })

  it('does NOT exclude random JSON outside locales/', () => {
    expect(isFileExcludedFromSizeCheck('/project/src/data/agents.json')).toBe(false)
  })

  it('handles Windows backslash paths for locales', () => {
    expect(isFileExcludedFromSizeCheck('C:\\project\\src\\locales\\en.json')).toBe(true)
  })
})

describe('hookServer-filesize — checkPostToolUseFileSize', () => {
  beforeEach(() => {
    updateFileSizeConfig(true, 400)
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
  })

  it('returns {} when config is disabled', () => {
    updateFileSizeConfig(false, 400)
    expect(checkPostToolUseFileSize(writePayload('/project/src/big.ts'))).toEqual({})
  })

  it('returns {} for non-Write/Edit tools', () => {
    const payload = { tool_name: 'Read', tool_input: { file_path: '/project/src/foo.ts' } }
    expect(checkPostToolUseFileSize(payload)).toEqual({})
  })

  it('returns {} when tool_input is missing', () => {
    const payload = { tool_name: 'Write' }
    expect(checkPostToolUseFileSize(payload)).toEqual({})
  })

  it('returns {} when file_path is missing', () => {
    const payload = { tool_name: 'Write', tool_input: {} }
    expect(checkPostToolUseFileSize(payload)).toEqual({})
  })

  it('returns {} when file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(checkPostToolUseFileSize(writePayload('/project/src/foo.ts'))).toEqual({})
  })

  it('returns {} when file is under the limit', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(200))
    expect(checkPostToolUseFileSize(writePayload('/project/src/foo.ts'))).toEqual({})
  })

  it('returns {} when file is exactly at the limit', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(400))
    expect(checkPostToolUseFileSize(writePayload('/project/src/foo.ts'))).toEqual({})
  })

  it('returns user_message when Write exceeds the limit', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(450))
    const result = checkPostToolUseFileSize(writePayload('/project/src/big.ts'))
    expect(result.user_message).toBeDefined()
    expect(result.user_message).toContain('big.ts')
    expect(result.user_message).toContain('450')
    expect(result.user_message).toContain('400')
  })

  it('returns user_message when Edit exceeds the limit', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(500))
    const result = checkPostToolUseFileSize(editPayload('/project/src/large.ts'))
    expect(result.user_message).toBeDefined()
    expect(result.user_message).toContain('large.ts')
    expect(result.user_message).toContain('500')
  })

  it('respects custom maxLines config', () => {
    updateFileSizeConfig(true, 200)
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(250))
    const result = checkPostToolUseFileSize(writePayload('/project/src/foo.ts'))
    expect(result.user_message).toContain('250')
    expect(result.user_message).toContain('200')
  })

  it('excludes test files', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(1000))
    expect(checkPostToolUseFileSize(writePayload('/project/src/foo.spec.ts'))).toEqual({})
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('excludes locale JSON', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(makeContent(2000))
    expect(checkPostToolUseFileSize(writePayload('/project/src/locales/en.json'))).toEqual({})
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('returns {} when fs.readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation(() => { throw new Error('EACCES') })
    expect(checkPostToolUseFileSize(writePayload('/project/src/foo.ts'))).toEqual({})
  })
})
