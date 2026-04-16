/**
 * Tests for useAgentForm composable (T1957)
 * File: src/renderer/src/composables/useAgentForm.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@renderer/plugins/i18n'
import { useAgentForm } from '@renderer/composables/useAgentForm'
import type { Agent } from '@renderer/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 42,
    name: 'dev-front-vuejs',
    type: 'dev',
    scope: 'front-vuejs',
    system_prompt: null,
    system_prompt_suffix: null,
    thinking_mode: 'auto',
    allowed_tools: null,
    auto_launch: 1,
    permission_mode: 'default',
    max_sessions: 3,
    worktree_enabled: null,
    preferred_model: null,
    preferred_cli: null,
    description: null,
    created_at: '',
    ...overrides,
  } as unknown as Agent
}

// Captured from composable setup — accessible in each test
type FormReturn = ReturnType<typeof useAgentForm>
let formRef: FormReturn
let emitsMock: {
  close: ReturnType<typeof vi.fn>
  created: ReturnType<typeof vi.fn>
  saved: ReturnType<typeof vi.fn>
  toast: ReturnType<typeof vi.fn>
}

/**
 * Mount a wrapper component hosting useAgentForm.
 * After mount, `formRef` holds all composable return values.
 * Also sets `tasks.dbPath` and `tasks.projectPath` on the active pinia store.
 */
function mountComposable(
  props: { mode?: 'create' | 'edit'; agent?: Agent } = {},
  dbPath: string | null = '/test/.claude/project.db',
) {
  // Pre-seed localStorage so projectStore initializes with correct dbPath
  if (dbPath) {
    localStorage.setItem('dbPath', dbPath)
    localStorage.setItem('projectPath', '/test')
  } else {
    localStorage.removeItem('dbPath')
    localStorage.removeItem('projectPath')
  }

  const Comp = defineComponent({
    setup() {
      formRef = useAgentForm(props, emitsMock)
      return formRef
    },
    template: '<div />',
  })

  return mount(Comp, {
    global: { plugins: [i18n] },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAgentForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()

    emitsMock = {
      close: vi.fn(),
      created: vi.fn(),
      saved: vi.fn(),
      toast: vi.fn(),
    }

    // Defaults for electronAPI
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getAgentSystemPrompt?.mockResolvedValue({
      success: true,
      systemPrompt: null,
      systemPromptSuffix: null,
      permissionMode: 'default',
      preferredModel: null,
      preferredCli: null,
    })
    api.getCliInstances?.mockResolvedValue([])
    api.getCliModels?.mockResolvedValue({})
    api.createAgent?.mockResolvedValue({ success: true, agentId: 1 })
    api.updateAgent?.mockResolvedValue({ success: true })
    api.deleteAgent?.mockResolvedValue({ success: true, hasHistory: false })
    // Required for tasks store cold-start when localStorage has a dbPath
    api.findProjectDb?.mockResolvedValue(null)
    api.migrateDb?.mockResolvedValue({ success: true })
    api.queryDb?.mockResolvedValue([])
    api.watchDb?.mockResolvedValue(undefined)
    api.onDbChanged?.mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── onNameInput ──────────────────────────────────────────────────────────────

  describe('onNameInput', () => {
    it('lowercases input and replaces spaces with dashes', async () => {
      mountComposable()
      formRef.onNameInput('Hello World')
      await nextTick()
      expect(formRef.name.value).toBe('hello-world')
    })

    it('lowercases only — no spaces', async () => {
      mountComposable()
      formRef.onNameInput('DevFront')
      await nextTick()
      expect(formRef.name.value).toBe('devfront')
    })

    it('clears nameError on name change', async () => {
      mountComposable()
      formRef.nameError.value = 'some error'
      formRef.onNameInput('valid-name')
      await nextTick()
      expect(formRef.nameError.value).toBe('')
    })
  })

  // ── isScoped ─────────────────────────────────────────────────────────────────

  describe('isScoped', () => {
    it.each(['dev', 'test', 'ux'])('is true for type=%s', async (agentType) => {
      mountComposable()
      formRef.type.value = agentType
      await nextTick()
      expect(formRef.isScoped.value).toBe(true)
    })

    it.each(['review', 'arch', 'doc', 'devops', 'review-master', 'planner'])('is false for type=%s', async (agentType) => {
      mountComposable()
      formRef.type.value = agentType
      await nextTick()
      expect(formRef.isScoped.value).toBe(false)
    })
  })

  // ── maxSessionsInvalid ───────────────────────────────────────────────────────

  describe('maxSessionsInvalid', () => {
    it('is false for empty string', async () => {
      mountComposable()
      formRef.maxSessions.value = ''
      await nextTick()
      expect(formRef.maxSessionsInvalid.value).toBe(false)
    })

    it('is false for valid positive integer', async () => {
      mountComposable()
      formRef.maxSessions.value = '5'
      await nextTick()
      expect(formRef.maxSessionsInvalid.value).toBe(false)
    })

    it('is true for non-numeric string', async () => {
      mountComposable()
      formRef.maxSessions.value = 'abc'
      await nextTick()
      expect(formRef.maxSessionsInvalid.value).toBe(true)
    })

    it('is true for 0', async () => {
      mountComposable()
      formRef.maxSessions.value = '0'
      await nextTick()
      expect(formRef.maxSessionsInvalid.value).toBe(true)
    })

    it('is true for float string', async () => {
      mountComposable()
      formRef.maxSessions.value = '1.5'
      await nextTick()
      expect(formRef.maxSessionsInvalid.value).toBe(true)
    })
  })

  // ── maxSessionsDbValue ───────────────────────────────────────────────────────

  describe('maxSessionsDbValue', () => {
    it('returns -1 for empty string', async () => {
      mountComposable()
      formRef.maxSessions.value = ''
      await nextTick()
      expect(formRef.maxSessionsDbValue.value).toBe(-1)
    })

    it('returns parsed integer for "5"', async () => {
      mountComposable()
      formRef.maxSessions.value = '5'
      await nextTick()
      expect(formRef.maxSessionsDbValue.value).toBe(5)
    })
  })

  // ── worktreeToggleValue ───────────────────────────────────────────────────────

  describe('worktreeToggleValue', () => {
    describe('getter', () => {
      it('null → "inherit"', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = null
        await nextTick()
        expect(formRef.worktreeToggleValue.value).toBe('inherit')
      })

      it('1 → "on"', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = 1
        await nextTick()
        expect(formRef.worktreeToggleValue.value).toBe('on')
      })

      it('0 → "off"', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = 0
        await nextTick()
        expect(formRef.worktreeToggleValue.value).toBe('off')
      })
    })

    describe('setter', () => {
      it('"inherit" → null', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = 1
        formRef.worktreeToggleValue.value = 'inherit'
        await nextTick()
        expect(formRef.worktreeEnabled.value).toBeNull()
      })

      it('"on" → 1', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = null
        formRef.worktreeToggleValue.value = 'on'
        await nextTick()
        expect(formRef.worktreeEnabled.value).toBe(1)
      })

      it('"off" → 0', async () => {
        mountComposable()
        formRef.worktreeEnabled.value = null
        formRef.worktreeToggleValue.value = 'off'
        await nextTick()
        expect(formRef.worktreeEnabled.value).toBe(0)
      })
    })
  })

  // ── watch(type): perimetre cleared when non-scoped ───────────────────────────

  describe('watch type → perimetre', () => {
    it('clears perimetre when switching to non-scoped type', async () => {
      mountComposable()
      formRef.type.value = 'dev'
      formRef.perimetre.value = 'front-vuejs'
      await nextTick()

      formRef.type.value = 'review'
      await nextTick()
      expect(formRef.perimetre.value).toBe('')
    })

    it('does not clear perimetre when staying scoped', async () => {
      mountComposable()
      formRef.type.value = 'dev'
      formRef.perimetre.value = 'front-vuejs'
      await nextTick()

      formRef.type.value = 'test'
      await nextTick()
      expect(formRef.perimetre.value).toBe('front-vuejs')
    })
  })

  // ── submit (create mode) ─────────────────────────────────────────────────────

  describe('submit — create mode', () => {
    it('sets nameError and does not call IPC when name is empty', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      mountComposable({ mode: 'create' })

      formRef.name.value = ''
      await formRef.submit()
      await flushPromises()

      expect(formRef.nameError.value).not.toBe('')
      expect(api.createAgent).not.toHaveBeenCalled()
      expect(emitsMock.close).not.toHaveBeenCalled()
    })

    it('sets nameError when name has uppercase chars', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      mountComposable({ mode: 'create' })

      formRef.name.value = 'Invalid-Name'
      // Flush the watch(name, () => nameError.value = '') watcher BEFORE calling submit,
      // so the watcher doesn't overwrite the nameError that submit sets.
      await nextTick()
      await formRef.submit()

      expect(formRef.nameError.value).not.toBe('')
      expect(api.createAgent).not.toHaveBeenCalled()
      expect(emitsMock.close).not.toHaveBeenCalled()
    })

    it('calls createAgent, emits created + close + toast on success', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      api.createAgent?.mockResolvedValue({ success: true, agentId: 5, claudeMdUpdated: false })

      mountComposable({ mode: 'create' })
      formRef.name.value = 'my-new-agent'
      formRef.type.value = 'dev'

      await formRef.submit()
      await flushPromises()

      expect(api.createAgent).toHaveBeenCalled()
      expect(emitsMock.created).toHaveBeenCalled()
      expect(emitsMock.close).toHaveBeenCalled()
      expect(emitsMock.toast).toHaveBeenCalledWith(expect.any(String), 'success')
    })

    it('sets nameError when IPC returns "existe déjà"', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      api.createAgent?.mockResolvedValue({ success: false, error: 'Agent existe déjà' })

      mountComposable({ mode: 'create' })
      formRef.name.value = 'my-agent'

      await formRef.submit()
      await flushPromises()

      expect(formRef.nameError.value).toContain('existe déjà')
      expect(emitsMock.close).not.toHaveBeenCalled()
    })

    it('returns early (no IPC) when store.dbPath is null', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      mountComposable({ mode: 'create' }, null)

      formRef.name.value = 'valid-agent'
      await formRef.submit()
      await flushPromises()

      expect(api.createAgent).not.toHaveBeenCalled()
    })
  })

  // ── submit (edit mode) ───────────────────────────────────────────────────────

  describe('submit — edit mode', () => {
    it('returns early without IPC when maxSessionsInvalid is true', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent })
      await flushPromises() // wait for onMounted

      formRef.name.value = 'dev-front-vuejs'
      formRef.maxSessions.value = 'abc'
      await formRef.submit()
      await flushPromises()

      expect(api.updateAgent).not.toHaveBeenCalled()
    })

    it('calls updateAgent, emits saved + close + toast on success', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      api.updateAgent?.mockResolvedValue({ success: true })

      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent })
      await flushPromises() // wait for onMounted

      formRef.name.value = 'dev-front-vuejs'
      formRef.maxSessions.value = '3'
      await formRef.submit()
      await flushPromises()

      expect(api.updateAgent).toHaveBeenCalled()
      expect(emitsMock.saved).toHaveBeenCalled()
      expect(emitsMock.close).toHaveBeenCalled()
      expect(emitsMock.toast).toHaveBeenCalledWith(expect.any(String), 'success')
    })
  })

  // ── deleteAgent ──────────────────────────────────────────────────────────────

  describe('deleteAgent', () => {
    it('does not call IPC when window.confirm is denied', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent })

      await formRef.deleteAgent()
      await flushPromises()

      expect(api.deleteAgent).not.toHaveBeenCalled()
    })

    it('sets deleteError when result.hasHistory is true', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      api.deleteAgent?.mockResolvedValue({ success: false, hasHistory: true })
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent })

      await formRef.deleteAgent()
      await flushPromises()

      expect(formRef.deleteError.value).not.toBeNull()
      expect(emitsMock.close).not.toHaveBeenCalled()
    })

    it('emits close on successful delete', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      api.deleteAgent?.mockResolvedValue({ success: true, hasHistory: false })
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent })
      await flushPromises() // wait for onMounted

      await formRef.deleteAgent()
      await flushPromises()

      expect(emitsMock.close).toHaveBeenCalled()
    })

    it('does nothing when store.dbPath is null', async () => {
      const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const agent = makeAgent()
      mountComposable({ mode: 'edit', agent }, null)

      await formRef.deleteAgent()
      await flushPromises()

      expect(api.deleteAgent).not.toHaveBeenCalled()
    })
  })
})
