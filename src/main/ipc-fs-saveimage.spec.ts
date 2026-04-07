/**
 * ipc-fs-saveimage.spec.ts — fs:saveImage handler tests (T1716)
 *
 * Covers: extension detection, directory creation, file write, return value.
 * Framework: Vitest (node environment)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => {
  const readdir = vi.fn().mockResolvedValue([])
  const readFile = vi.fn().mockResolvedValue('content')
  const writeFile = vi.fn().mockResolvedValue(undefined)
  const mkdir = vi.fn().mockResolvedValue(undefined)
  return {
    default: { readdir, readFile, writeFile, mkdir },
    readdir,
    readFile,
    writeFile,
    mkdir,
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))

vi.mock('./db', () => ({
  assertProjectPathAllowed: vi.fn(),
}))

import { mkdir, writeFile } from 'fs/promises'
import { ipcMain, app } from 'electron'
import { registerFsHandlers } from './ipc-fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getHandlers(): Record<string, Function> {
  const handlers: Record<string, Function> = {}
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, fn: Function) => {
    handlers[channel] = fn
    return undefined as any
  })
  registerFsHandlers()
  return handlers
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fs:saveImage handler', () => {
  let handlers: Record<string, Function>
  const fakeEvent = {}

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(app.getPath).mockReturnValue('/tmp')
    handlers = getHandlers()
  })

  it('returns { success: true, path } for a PNG image', async () => {
    const base64 = Buffer.from('fake-png-data').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/png')
    expect(result).toMatchObject({ success: true })
    expect(typeof result.path).toBe('string')
    expect(result.path).toMatch(/\.png$/)
  })

  it('uses .webp extension for image/webp', async () => {
    const base64 = Buffer.from('fake-webp').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/webp')
    expect(result.path).toMatch(/\.webp$/)
  })

  it('uses .jpg extension for image/jpeg', async () => {
    const base64 = Buffer.from('fake-jpg').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/jpeg')
    expect(result.path).toMatch(/\.jpg$/)
  })

  it('uses .jpg extension for unknown media type', async () => {
    const base64 = Buffer.from('fake-data').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/bmp')
    expect(result.path).toMatch(/\.jpg$/)
  })

  it('path contains kanbagent/images directory structure', async () => {
    const base64 = Buffer.from('x').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/png')
    expect(result.path).toContain('kanbagent')
    expect(result.path).toContain('images')
  })

  it('creates the directory with recursive: true', async () => {
    const base64 = Buffer.from('x').toString('base64')
    await handlers['fs:saveImage'](fakeEvent, base64, 'image/png')
    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining('kanbagent'),
      { recursive: true }
    )
  })

  it('writes file with base64-decoded buffer', async () => {
    const data = 'hello image'
    const base64 = Buffer.from(data).toString('base64')
    await handlers['fs:saveImage'](fakeEvent, base64, 'image/png')
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.png$/),
      Buffer.from(data)
    )
  })

  it('filename has img- prefix, timestamp, and random suffix', async () => {
    const base64 = Buffer.from('x').toString('base64')
    const result = await handlers['fs:saveImage'](fakeEvent, base64, 'image/png')
    const filename = result.path.split(/[/\\]/).pop()
    expect(filename).toMatch(/^img-\d+-[a-z0-9]+\.png$/)
  })
})
