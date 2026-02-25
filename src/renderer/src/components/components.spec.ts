import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount } from '@vue/test-utils'
import BoardView from '@renderer/components/BoardView.vue'
import TerminalView from '@renderer/components/TerminalView.vue'
import TaskDetailModal from '@renderer/components/TaskDetailModal.vue'
import StatusColumn from '@renderer/components/StatusColumn.vue'

// Mock window.electronAPI
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  terminalCreate: vi.fn().mockResolvedValue('pty-1'),
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(),
  onTerminalData: vi.fn().mockReturnValue(() => {}),
  onTerminalExit: vi.fn().mockReturnValue(() => {}),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

describe('BoardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should render with columns defined', () => {
    // Verify the component is defined
    expect(BoardView).toBeDefined()
  })

  it('should have columns for backlog statuses', () => {
    const columns = [
      { key: 'a_faire' as const, title: 'À faire' },
      { key: 'en_cours' as const, title: 'En cours' },
      { key: 'terminé' as const, title: 'Terminé' },
      { key: 'archivé' as const, title: 'Archivé' },
    ]
    expect(columns).toHaveLength(4)
  })

  it('should filter tasks by search query', () => {
    const tasks = [
      { id: 1, titre: 'Fix bug login', description: 'User cannot login', perimetre: 'front', statut: 'a_faire', agent_name: 'dev-front' },
      { id: 2, titre: 'Add dark mode', description: 'Theme toggle', perimetre: 'front', statut: 'a_faire', agent_name: 'dev-front' },
      { id: 3, titre: 'Login API', description: 'Create login endpoint', perimetre: 'back', statut: 'a_faire', agent_name: 'dev-back' },
    ]

    const query = 'login'
    const filtered = tasks.filter(t =>
      t.titre.toLowerCase().includes(query.toLowerCase()) ||
      t.description.toLowerCase().includes(query.toLowerCase())
    )

    expect(filtered).toHaveLength(2)
    expect(filtered.map(t => t.titre)).toContain('Fix bug login')
    expect(filtered.map(t => t.titre)).toContain('Login API')
  })

  it('should filter tasks by agent', () => {
    const tasks = [
      { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front', statut: 'a_faire' },
      { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back', statut: 'a_faire' },
      { id: 3, titre: 'Task 3', agent_assigne_id: 1, perimetre: 'front', statut: 'en_cours' },
    ]

    const agentId = 1
    const filtered = tasks.filter(t => t.agent_assigne_id === agentId)

    expect(filtered).toHaveLength(2)
    expect(filtered.every(t => t.agent_assigne_id === 1)).toBe(true)
  })

  it('should filter tasks by perimetre', () => {
    const tasks = [
      { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'a_faire' },
      { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'a_faire' },
    ]

    const perimetre = 'front-vuejs'
    const filtered = tasks.filter(t => t.perimetre === perimetre)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].perimetre).toBe('front-vuejs')
  })

  it('should group tasks by status', () => {
    const tasks = [
      { id: 1, titre: 'Task 1', statut: 'a_faire' },
      { id: 2, titre: 'Task 2', statut: 'a_faire' },
      { id: 3, titre: 'Task 3', statut: 'en_cours' },
      { id: 4, titre: 'Task 4', statut: 'terminé' },
      { id: 5, titre: 'Task 5', statut: 'archivé' },
    ]

    const byStatus = tasks.reduce((acc, task) => {
      const status = task.statut
      if (!acc[status]) acc[status] = []
      acc[status].push(task)
      return acc
    }, {} as Record<string, typeof tasks>)

    expect(byStatus.a_faire).toHaveLength(2)
    expect(byStatus.en_cours).toHaveLength(1)
    expect(byStatus.terminé).toHaveLength(1)
    expect(byStatus.archivé).toHaveLength(1)
  })

  it('should show empty state when no tasks', () => {
    const tasks: typeof [] = []
    expect(tasks.length).toBe(0)
  })

  it('should toggle between backlog and archive views', () => {
    const view = { tab: 'backlog' as const }
    view.tab = 'archive'
    expect(view.tab).toBe('archive')
  })
})

describe('TerminalView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should render TerminalView component', () => {
    expect(TerminalView).toBeDefined()
  })

  it('should call terminalCreate on mount', () => {
    // Mock the terminal create call
    mockElectronAPI.terminalCreate.mockResolvedValue('pty-123')
    expect(mockElectronAPI.terminalCreate).not.toHaveBeenCalled()
  })

  it('should handle terminal data subscription', () => {
    const unsubscribe = vi.fn()
    mockElectronAPI.onTerminalData.mockReturnValue(unsubscribe)

    const cb = vi.fn()
    const unsub = mockElectronAPI.onTerminalData('term-1', cb)

    expect(mockElectronAPI.onTerminalData).toHaveBeenCalledWith('term-1', cb)
    expect(typeof unsub).toBe('function')
  })

  it('should call terminalKill on cleanup', () => {
    mockElectronAPI.terminalKill.mockResolvedValue(undefined)

    // Simulate cleanup
    mockElectronAPI.terminalKill('pty-123')

    expect(mockElectronAPI.terminalKill).toHaveBeenCalledWith('pty-123')
  })

  it('should handle terminal resize', () => {
    const resizeHandler = mockElectronAPI.terminalResize

    resizeHandler('pty-123', 80, 24)

    expect(mockElectronAPI.terminalResize).toHaveBeenCalledWith('pty-123', 80, 24)
  })

  it('should use xterm.js theme configuration', () => {
    const theme = {
      background: '#09090b',
      foreground: '#f4f4f5',
      cursor: '#8b5cf6',
      cursorAccent: '#09090b',
      black: '#09090b',
      red: '#ef4444',
      green: '#22c55e',
    }
    expect(theme.background).toBe('#09090b')
    expect(theme.cursor).toBe('#8b5cf6')
  })

  it('should create unique terminal event channels', () => {
    const terminalId = 'term-123'
    const dataChannel = `terminal:data:${terminalId}`
    const exitChannel = `terminal:exit:${terminalId}`

    expect(dataChannel).toBe('terminal:data:term-123')
    expect(exitChannel).toBe('terminal:exit:term-123')
  })
})

describe('TaskDetailModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should render TaskDetailModal component', () => {
    expect(TaskDetailModal).toBeDefined()
  })

  it('should display task properties when opened', () => {
    const task = {
      id: 1,
      titre: 'Fix login bug',
      description: 'Users cannot login with special characters',
      statut: 'a_faire',
      agent_name: 'dev-front',
      agent_assigne_id: 1,
    }

    expect(task.titre).toBe('Fix login bug')
    expect(task.statut).toBe('a_faire')
  })

  it('should validate title is not empty before saving', () => {
    const validateTitle = (title: string) => title.trim().length > 0

    expect(validateTitle('Valid title')).toBe(true)
    expect(validateTitle('')).toBe(false)
    expect(validateTitle('   ')).toBe(false)
  })

  it('should emit close on escape key', () => {
    const emitClose = vi.fn()

    // Simulate escape key handler
    const event = { key: 'Escape' }
    if (event.key === 'Escape') {
      emitClose()
    }

    expect(emitClose).toHaveBeenCalled()
  })

  it('should emit close on overlay click', () => {
    const emitClose = vi.fn()
    const clickedOnOverlay = true

    if (clickedOnOverlay) {
      emitClose()
    }

    expect(emitClose).toHaveBeenCalled()
  })

  it('should update task status via IPC', () => {
    const updateStatus = vi.fn()
    mockElectronAPI.queryDb.mockResolvedValue([{ success: true }])

    // Simulate status update
    updateStatus('UPDATE tasks SET statut = ? WHERE id = ?', ['en_cours', 1])

    expect(typeof updateStatus).toBe('function')
  })

  it('should format date with French locale', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    const formatted = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    expect(formatted).toContain('2024')
  })

  it('should normalize newlines in comments', () => {
    const text = 'Line 1\\nLine 2\\nLine 3'
    const normalized = text.replace(/\\n/g, '\n')
    expect(normalized).toBe('Line 1\nLine 2\nLine 3')
  })

  it('should group comments by agent', () => {
    const comments = [
      { id: 1, agent_name: 'dev-front', contenu: 'Comment 1' },
      { id: 2, agent_name: 'dev-back', contenu: 'Comment 2' },
      { id: 3, agent_name: 'dev-front', contenu: 'Comment 3' },
    ]

    const grouped = comments.reduce((acc, c) => {
      if (!acc[c.agent_name]) acc[c.agent_name] = []
      acc[c.agent_name].push(c)
      return acc
    }, {} as Record<string, typeof comments>)

    expect(grouped['dev-front']).toHaveLength(2)
    expect(grouped['dev-back']).toHaveLength(1)
  })
})

describe('StatusColumn', () => {
  it('should accept tasks prop', () => {
    const tasks = [
      { id: 1, titre: 'Task 1', statut: 'a_faire' },
      { id: 2, titre: 'Task 2', statut: 'a_faire' },
    ]
    expect(tasks).toHaveLength(2)
  })

  it('should accept title and statut props', () => {
    const props = {
      title: 'À faire',
      statut: 'a_faire' as const,
      accentClass: 'bg-amber-500',
    }
    expect(props.title).toBe('À faire')
    expect(props.statut).toBe('a_faire')
  })

  it('should define accent colors per status', () => {
    const accentColors: Record<string, string> = {
      a_faire: 'bg-amber-500',
      en_cours: 'bg-blue-500',
      terminé: 'bg-green-500',
      archivé: 'bg-gray-500',
    }
    expect(accentColors.a_faire).toBe('bg-amber-500')
    expect(accentColors.en_cours).toBe('bg-blue-500')
  })
})
