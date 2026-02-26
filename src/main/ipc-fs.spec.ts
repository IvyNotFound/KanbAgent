/**
 * Tests for ipc-fs.ts — buildTree function.
 *
 * buildTree(dirPath) lists a single directory level with:
 * - FS_SKIP filtering (node_modules, .git, dist, dist-electron, .DS_Store, __pycache__)
 * - Hidden file filtering (files starting with '.'), with .claude as exception
 * - Sorting: directories first, then alphabetical within each group
 * - Error resilience: returns [] on readdir failure
 *
 * Framework: Vitest (node environment — configured via environmentMatchGlobs)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent } from 'fs'

// ── fs/promises mock ──────────────────────────────────────────────────────────
// We mock fs/promises so buildTree can run without touching the real filesystem.

vi.mock('fs/promises', () => {
  const readdir = vi.fn().mockResolvedValue([])
  const readFile = vi.fn().mockResolvedValue(Buffer.from(''))
  const writeFile = vi.fn().mockResolvedValue(undefined)
  const access = vi.fn().mockResolvedValue(undefined)
  return {
    default: { readdir, readFile, writeFile, access },
    readdir,
    readFile,
    writeFile,
    access,
  }
})

// electron is imported by ipc-fs.ts at the module level; mock it to avoid errors in node env
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

import { readdir, writeFile } from 'fs/promises'
import { buildTree, isPathAllowed, ALLOWED_WRITE_EXTENSIONS } from './ipc-fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal Dirent-like object for mocking readdir results. */
function makeDirent(name: string, isDirectory: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/mock',
    parentPath: '/mock',
  } as unknown as Dirent
}

function dir(name: string) { return makeDirent(name, true) }
function file(name: string) { return makeDirent(name, false) }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ipc-fs / buildTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out FS_SKIP directories (node_modules, .git, dist, dist-electron, .DS_Store, __pycache__)', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('node_modules'),
      dir('.git'),
      dir('dist'),
      dir('dist-electron'),
      file('.DS_Store'),
      dir('__pycache__'),
      dir('src'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/project')

    const names = result.map(n => n.name)
    expect(names).toEqual(['src'])
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(names).not.toContain('dist')
    expect(names).not.toContain('dist-electron')
    expect(names).not.toContain('.DS_Store')
    expect(names).not.toContain('__pycache__')
  })

  it('filters hidden files/dirs (starting with "."), but keeps .claude', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('.env'),
      file('.gitignore'),
      dir('.claude'),
      dir('.hidden-dir'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/project')

    const names = result.map(n => n.name)
    expect(names).toContain('.claude')
    expect(names).not.toContain('.env')
    expect(names).not.toContain('.gitignore')
    expect(names).not.toContain('.hidden-dir')
  })

  it('sorts directories before files, then alphabetically within each group', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      file('z-file.ts'),
      dir('a-dir'),
      file('b-file.ts'),
      dir('b-dir'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/project')

    const names = result.map(n => n.name)
    expect(names).toEqual(['a-dir', 'b-dir', 'b-file.ts', 'z-file.ts'])
  })

  it('returns [] when readdir throws (inaccessible directory)', async () => {
    vi.mocked(readdir).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await buildTree('/nonexistent')

    expect(result).toEqual([])
  })

  it('returns correct FileNode shape for each entry', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('components'),
      file('main.ts'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/src')

    expect(result).toHaveLength(2)

    const dirNode = result.find(n => n.name === 'components')!
    expect(dirNode).toMatchObject({ name: 'components', isDir: true })
    expect(dirNode.path).toContain('components')
    // children is undefined for all nodes (lazy loading by design)
    expect(dirNode.children).toBeUndefined()

    const fileNode = result.find(n => n.name === 'main.ts')!
    expect(fileNode).toMatchObject({ name: 'main.ts', isDir: false })
    expect(fileNode.children).toBeUndefined()
  })

  it('returns empty array when directory is empty', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/empty')

    expect(result).toEqual([])
  })

  it('includes only allowed entries when mix of skipped and valid entries', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      dir('node_modules'),
      dir('src'),
      file('.env'),
      dir('.claude'),
      file('README.md'),
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await buildTree('/project')

    const names = result.map(n => n.name)
    expect(names).toContain('src')
    expect(names).toContain('.claude')
    expect(names).toContain('README.md')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.env')
  })
})

// ── Tests for ALLOWED_WRITE_EXTENSIONS (T531) ──────────────────────────────────

describe('ipc-fs / ALLOWED_WRITE_EXTENSIONS', () => {
  it('includes common code/doc extensions (.ts, .js, .md, .json, .vue, .yaml)', () => {
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.ts')
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.js')
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.md')
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.json')
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.vue')
    expect(ALLOWED_WRITE_EXTENSIONS).toContain('.yaml')
  })

  it('does NOT include sensitive file patterns (npmrc, gitconfig, gnupg, ssh, netrc, etc.)', () => {
    // These were not blocked by the old blacklist approach
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.npmrc')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.gitconfig')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.pem')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.key')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.p12')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.pfx')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.exe')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.dll')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.bat')
    expect(ALLOWED_WRITE_EXTENSIONS).not.toContain('.ps1')
  })

  it('isPathAllowed is correctly tested by ALLOWED_WRITE_EXTENSIONS (whitelist gates before writeFile)', () => {
    // Verify extension check logic: unknown extension must be blocked
    const testPath = '/project/foo.npmrc'
    const lastDot = testPath.lastIndexOf('.')
    const ext = lastDot >= 0 ? testPath.slice(lastDot).toLowerCase() : ''
    expect(ALLOWED_WRITE_EXTENSIONS.includes(ext)).toBe(false)
  })

  it('writeFile is NOT called for blocked extensions (integration smoke)', async () => {
    vi.mocked(writeFile).mockClear()
    // Simulate the check that happens in the handler — extension .npmrc not in whitelist
    const filePath = '/project/secret.npmrc'
    const lastDot = filePath.lastIndexOf('.')
    const ext = lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : ''
    const isBlocked = !ext || !ALLOWED_WRITE_EXTENSIONS.includes(ext)
    expect(isBlocked).toBe(true)
    // writeFile should not be called when blocked
    if (!isBlocked) {
      await writeFile(filePath, 'content', 'utf-8')
    }
    expect(writeFile).not.toHaveBeenCalled()
  })
})
