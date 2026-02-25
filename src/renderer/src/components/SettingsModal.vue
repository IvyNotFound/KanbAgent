<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', message: string, type: 'success' | 'error'): void
}>()

const settingsStore = useSettingsStore()
const store = useTasksStore()

const githubToken = ref('')
const githubRepo = ref(settingsStore.github.repoUrl)
const checkingUpdates = ref(false)
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
    const res = await window.electronAPI.getConfigValue(store.dbPath, 'github_token')
    if (res.success && res.value) githubToken.value = res.value

    const shaRes = await window.electronAPI.getConfigValue(store.dbPath, 'claude_md_commit')
    if (shaRes.success && shaRes.value) {
      settingsStore.setClaudeMdInfo({ projectCommit: shaRes.value })
    }
  }
})

async function saveToken() {
  if (!store.dbPath) return
  await window.electronAPI.setConfigValue(store.dbPath, 'github_token', githubToken.value)
}

async function testGithubConnection() {
  if (!store.dbPath || !githubRepo.value) return
  settingsStore.setGitHubRepo(githubRepo.value)
  const result = await window.electronAPI.testGithubConnection(store.dbPath, githubRepo.value)
  settingsStore.setGitHubConnected(result.connected)
  if (result.connected) {
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
      <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h2 class="text-lg font-semibold text-zinc-100">Paramètres</h2>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Fermer"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          <!-- Theme -->
          <div class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-2 uppercase tracking-wider">Thème</p>
            <div class="flex gap-2">
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'dark'
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                ]"
                @click="settingsStore.setTheme('dark')"
              >Sombre</button>
              <button
                :class="[
                  'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
                  settingsStore.theme === 'light'
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                ]"
                @click="settingsStore.setTheme('light')"
              >Clair</button>
            </div>
          </div>

          <!-- GitHub Connection -->
          <div class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-3 uppercase tracking-wider">Connexion GitHub</p>

            <!-- Token input -->
            <div class="mb-3">
              <label class="block text-xs text-zinc-400 mb-1">Token GitHub (optionnel)</label>
              <input
                v-model="githubToken"
                type="password"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="ghp_xxxxxxxxxxxx"
                :disabled="!store.dbPath"
                @change="saveToken"
              />
            </div>

            <!-- Repo URL input -->
            <div class="mb-3">
              <label class="block text-xs text-zinc-400 mb-1">URL du dépôt</label>
              <input
                v-model="githubRepo"
                type="text"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="https://github.com/owner/repo"
                @change="settingsStore.setGitHubRepo(githubRepo)"
              />
            </div>

            <!-- Connection status & test -->
            <div class="flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <span
                  :class="[
                    'inline-block w-2 h-2 rounded-full',
                    settingsStore.github.connected ? 'bg-emerald-400' : 'bg-zinc-600'
                  ]"
                />
                <span
                  :class="[
                    'text-sm font-medium',
                    settingsStore.github.connected ? 'text-emerald-400' : 'text-zinc-500'
                  ]"
                >
                  {{ settingsStore.github.connected ? 'Connecté' : 'Non connecté' }}
                </span>
              </span>
              <button
                class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="!githubRepo"
                @click="testGithubConnection"
              >
                Tester
              </button>
            </div>
          </div>

          <!-- Check for Updates -->
          <div class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-3 uppercase tracking-wider">Mises à jour</p>
            <div class="flex items-center justify-between">
              <span class="text-sm text-zinc-400">
                Version: <span class="font-mono text-zinc-300">{{ settingsStore.appInfo.version }}</span>
              </span>
              <button
                class="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="!settingsStore.github.connected || checkingUpdates"
                @click="checkUpdates"
              >
                {{ checkingUpdates ? '...' : 'Vérifier' }}
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
          <div class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-3 uppercase tracking-wider">CLAUDE.md</p>
            <div class="text-sm text-zinc-400 space-y-1 mb-3">
              <p>Projet: <span class="font-mono text-zinc-300 text-xs">{{ settingsStore.claudeMdInfo.projectCommit ? settingsStore.claudeMdInfo.projectCommit.slice(0, 12) : '—' }}</span></p>
              <p>Master: <span class="font-mono text-zinc-300 text-xs">{{ settingsStore.claudeMdInfo.masterCommit ? settingsStore.claudeMdInfo.masterCommit.slice(0, 12) : '—' }}</span></p>
            </div>

            <!-- Status feedback -->
            <div v-if="claudeMdStatus === 'up-to-date'" class="mb-2 text-sm text-emerald-400">
              À jour
            </div>
            <div v-else-if="claudeMdStatus === 'update-available'" class="mb-2 text-sm text-amber-400">
              Mise à jour disponible
            </div>
            <div v-else-if="claudeMdStatus === 'error'" class="mb-2 text-xs text-red-400 break-all">
              {{ claudeMdError }}
            </div>

            <div v-if="!store.dbPath" class="text-xs text-zinc-500">Aucun projet ouvert</div>
            <div v-else class="flex gap-2">
              <button
                class="flex-1 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="claudeMdChecking || claudeMdApplying"
                @click="checkClaudeMdStatus"
              >
                {{ claudeMdChecking ? 'Vérification...' : 'Vérifier' }}
              </button>
              <button
                v-if="claudeMdStatus === 'update-available'"
                class="flex-1 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors disabled:opacity-50"
                :disabled="claudeMdApplying"
                @click="applyClaudeMdUpdate"
              >
                {{ claudeMdApplying ? 'Mise à jour...' : 'Appliquer' }}
              </button>
            </div>
          </div>

          <!-- About -->
          <div class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-2 uppercase tracking-wider">À propos</p>
            <p class="text-sm text-zinc-300">
              {{ settingsStore.appInfo.name }} v{{ settingsStore.appInfo.version }}
            </p>
            <p class="text-xs text-zinc-500 mt-1">
              Interface desktop pour visualiser les tâches des agents Claude
            </p>
          </div>

          <!-- DB Info -->
          <div v-if="store.dbPath" class="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
            <p class="text-[11px] text-zinc-500 mb-2 uppercase tracking-wider">Base de données</p>
            <p class="text-sm text-zinc-400 font-mono break-all">{{ store.dbPath }}</p>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>
