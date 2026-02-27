<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import ToggleSwitch from '@renderer/components/ToggleSwitch.vue'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()
const store = useTasksStore()

const githubRepo = ref(settingsStore.github.repoUrl)
const checkingUpdates = ref(false)
const connectionError = ref('')
const updateStatus = ref('')
const updateAvailable = ref(false)

// CLAUDE.md sync state
const claudeMdChecking = ref(false)
const claudeMdApplying = ref(false)
const claudeMdStatus = ref<'idle' | 'up-to-date' | 'update-available' | 'error'>('idle')
const claudeMdError = ref('')
const pendingContent = ref<string | null>(null)
const pendingSha = ref<string | null>(null)

onMounted(async () => {
  if (store.dbPath) {
    const shaRes = await window.electronAPI.getConfigValue(store.dbPath, 'claude_md_commit')
    if (shaRes.success && shaRes.value) {
      settingsStore.setClaudeMdInfo({ projectCommit: shaRes.value })
    }

    // Silent reconnection if repo already configured
    if (githubRepo.value) {
      await testGithubConnection()
    }
  }
})

async function testGithubConnection() {
  if (!store.dbPath || !githubRepo.value) return
  connectionError.value = ''
  settingsStore.setGitHubRepo(githubRepo.value)
  const result = await window.electronAPI.testGithubConnection(store.dbPath, githubRepo.value)
  settingsStore.setGitHubConnected(result.connected)
  // Bug 2 fix: display error message if connection failed
  if (!result.connected) {
    connectionError.value = result.error || 'Connexion échouée'
  } else {
    connectionError.value = ''
    await checkClaudeMdStatus()
  }
}

async function checkUpdates() {
  if (!store.dbPath || !githubRepo.value) return
  checkingUpdates.value = true
  updateStatus.value = ''
  try {
    const result = await window.electronAPI.checkForUpdates(store.dbPath, githubRepo.value, settingsStore.appInfo.version)
    updateAvailable.value = result.hasUpdate
    if (result.hasUpdate) {
      updateStatus.value = `v${result.latestVersion} disponible`
    } else if (result.latestVersion) {
      updateStatus.value = `À jour (v${result.latestVersion})`
    } else {
      updateStatus.value = 'Erreur de vérification'
    }
  } catch {
    updateStatus.value = 'Erreur de vérification'
  } finally {
    checkingUpdates.value = false
  }
}

async function checkClaudeMdStatus() {
  if (!store.dbPath) return
  claudeMdChecking.value = true
  claudeMdStatus.value = 'idle'
  claudeMdError.value = ''
  pendingContent.value = null
  pendingSha.value = null

  try {
    const result = await window.electronAPI.checkMasterClaudeMd(store.dbPath)
    if (!result.success) {
      claudeMdStatus.value = 'error'
      claudeMdError.value = result.error ?? 'Erreur inconnue'
      return
    }

    settingsStore.setClaudeMdInfo({ masterCommit: result.sha ?? null })

    if (result.upToDate) {
      claudeMdStatus.value = 'up-to-date'
    } else {
      claudeMdStatus.value = 'update-available'
      pendingContent.value = result.content ?? null
      pendingSha.value = result.sha ?? null
    }
  } catch (err) {
    claudeMdStatus.value = 'error'
    claudeMdError.value = String(err)
  } finally {
    claudeMdChecking.value = false
  }
}

async function applyClaudeMdUpdate() {
  if (!store.dbPath || !store.projectPath || !pendingContent.value || !pendingSha.value) return
  claudeMdApplying.value = true
  try {
    const result = await window.electronAPI.applyMasterClaudeMd(
      store.dbPath,
      store.projectPath,
      pendingContent.value,
      pendingSha.value
    )
    if (result.success) {
      settingsStore.setClaudeMdInfo({ projectCommit: pendingSha.value, needsUpdate: false })
      claudeMdStatus.value = 'up-to-date'
      pendingContent.value = null
      pendingSha.value = null
      emit('toast', 'CLAUDE.md mis à jour avec succès', 'success')
    } else {
      emit('toast', result.error ?? 'Erreur lors de la mise à jour', 'error')
    }
  } catch (err) {
    emit('toast', String(err), 'error')
  } finally {
    claudeMdApplying.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="emit('close')"
      @keydown="handleKeydown"
    >
      <div class="bg-surface-primary border border-edge-default rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-edge-subtle shrink-0">
          <h2 class="text-lg font-semibold text-content-primary">{{ t('settings.title') }}</h2>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-content-subtle hover:text-content-secondary hover:bg-surface-secondary transition-colors"
            :title="t('settings.fermer')"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          <!-- Language -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.language') }}</p>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.language === 'fr'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setLanguage('fr')"
              >{{ t('settings.french') }}</button>
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.language === 'en'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setLanguage('en')"
              >{{ t('settings.english') }}</button>
            </div>
          </div>

          <!-- Theme -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.theme') }}</p>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'dark'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setTheme('dark')"
              >{{ t('settings.dark') }}</button>
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'light'
                    ? 'bg-violet-600 text-white'
                    : 'bg-surface-secondary text-content-muted hover:bg-surface-tertiary'
                ]"
                @click="settingsStore.setTheme('light')"
              >{{ t('settings.light') }}</button>
            </div>
          </div>

          <!-- Auto-launch agent sessions (T340) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoLaunch') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.autoLaunchDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.autoLaunchAgentSessions"
                @update:model-value="settingsStore.setAutoLaunchAgentSessions($event)"
              />
            </div>
          </div>

          <!-- Auto-review threshold (T341) -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <div class="flex items-center justify-between gap-4 mb-2">
              <div>
                <p class="text-[11px] text-content-subtle mb-1 uppercase tracking-wider">{{ t('settings.autoReview') }}</p>
                <p class="text-xs text-content-faint">{{ t('settings.autoReviewDesc') }}</p>
              </div>
              <ToggleSwitch
                :model-value="settingsStore.autoReviewEnabled"
                @update:model-value="settingsStore.setAutoReviewEnabled($event)"
              />
            </div>
            <div v-if="settingsStore.autoReviewEnabled" class="flex items-center gap-2 mt-2">
              <label class="text-xs text-content-muted">{{ t('settings.autoReviewThreshold') }}</label>
              <input
                type="number"
                :value="settingsStore.autoReviewThreshold"
                min="3"
                max="100"
                class="w-16 bg-surface-secondary border border-edge-default rounded px-2 py-1 text-sm text-content-primary text-center outline-none focus:ring-1 focus:ring-violet-500"
                @change="settingsStore.setAutoReviewThreshold(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>

          <!-- GitHub Connection -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.github') }}</p>

            <!-- Repo URL input -->
            <div class="mb-3">
              <label class="block text-xs text-content-muted mb-1">{{ t('settings.repoLabel') }}</label>
              <input
                v-model="githubRepo"
                type="text"
                class="w-full bg-surface-secondary border border-edge-default rounded-md px-3 py-2 text-sm text-content-primary font-mono outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="https://github.com/owner/repo"
                @change="settingsStore.setGitHubRepo(githubRepo)"
              />
            </div>

            <!-- Connection status & test -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="flex items-center gap-1.5">
                  <span
                    :class="[
                      'inline-block w-2 h-2 rounded-full',
                      settingsStore.github.connected ? 'bg-emerald-400' : 'bg-content-faint'
                    ]"
                  />
                  <span
                    :class="[
                      'text-sm font-medium',
                      settingsStore.github.connected ? 'text-emerald-400' : 'text-content-subtle'
                    ]"
                  >
                    {{ settingsStore.github.connected ? t('settings.connected') : t('settings.notConnected') }}
                  </span>
                </span>
                <!-- Bug 2 fix: show error message -->
                <span v-if="connectionError" class="text-xs text-red-400 mt-1">{{ connectionError }}</span>
              </div>
              <button
                class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="!githubRepo"
                @click="testGithubConnection"
              >
                {{ t('settings.test') }}
              </button>
            </div>
          </div>

          <!-- Check for Updates -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.updates') }}</p>
            <div class="flex items-center justify-between">
              <span class="text-sm text-content-muted">
                {{ t('settings.version') }}: <span class="font-mono text-content-tertiary">{{ settingsStore.appInfo.version }}</span>
              </span>
              <button
                class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="!settingsStore.github.connected || checkingUpdates"
                @click="checkUpdates"
              >
                {{ checkingUpdates ? '...' : t('settings.check') }}
              </button>
            </div>
            <div v-if="updateStatus" class="mt-2">
              <span
                :class="[
                  'text-sm font-medium',
                  updateAvailable ? 'text-amber-400' : 'text-emerald-400'
                ]"
              >
                {{ updateStatus }}
              </span>
            </div>
          </div>

          <!-- CLAUDE.md Sync -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-3 uppercase tracking-wider">{{ t('settings.claudeMd') }}</p>
            <div class="text-sm text-content-muted space-y-1 mb-3">
              <p>{{ t('settings.project') }}: <span class="font-mono text-content-tertiary text-xs">{{ settingsStore.claudeMdInfo.projectCommit ? settingsStore.claudeMdInfo.projectCommit.slice(0, 12) : '—' }}</span></p>
              <p>{{ t('settings.master') }}: <span class="font-mono text-content-tertiary text-xs">{{ settingsStore.claudeMdInfo.masterCommit ? settingsStore.claudeMdInfo.masterCommit.slice(0, 12) : '—' }}</span></p>
            </div>

            <!-- Status feedback -->
            <div v-if="claudeMdStatus === 'up-to-date'" class="mb-2 text-sm text-emerald-400">
              {{ t('settings.upToDate') }}
            </div>
            <div v-else-if="claudeMdStatus === 'update-available'" class="mb-2 text-sm text-amber-400">
              {{ t('settings.updateAvailable') }}
            </div>
            <div v-else-if="claudeMdStatus === 'error'" class="mb-2 text-xs text-red-400 break-all">
              {{ claudeMdError }}
            </div>

            <div v-if="!store.dbPath" class="text-xs text-content-subtle">{{ t('settings.noProject') }}</div>
            <div v-else class="flex gap-2">
              <button
                class="flex-1 py-2 text-sm bg-surface-tertiary hover:bg-content-faint text-content-primary rounded-md transition-colors disabled:opacity-50"
                :disabled="claudeMdChecking || claudeMdApplying"
                @click="checkClaudeMdStatus"
              >
                {{ claudeMdChecking ? t('settings.checking') : t('settings.check') }}
              </button>
              <button
                v-if="claudeMdStatus === 'update-available'"
                class="flex-1 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="claudeMdApplying"
                @click="applyClaudeMdUpdate"
              >
                {{ claudeMdApplying ? t('settings.applying') : t('settings.apply') }}
              </button>
            </div>
          </div>

          <!-- About -->
          <div class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.about') }}</p>
            <p class="text-sm text-content-tertiary">
              {{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}
            </p>
            <p class="text-xs text-content-subtle mt-1">
              {{ t('settings.aboutDesc') }}
            </p>
          </div>

          <!-- DB Info -->
          <div v-if="store.dbPath" class="bg-surface-base border border-edge-subtle rounded-lg px-4 py-3">
            <p class="text-[11px] text-content-subtle mb-2 uppercase tracking-wider">{{ t('settings.database') }}</p>
            <p class="text-sm text-content-muted font-mono break-all">{{ store.dbPath }}</p>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>
