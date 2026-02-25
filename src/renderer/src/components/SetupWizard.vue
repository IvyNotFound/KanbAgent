<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  projectPath: string
  hasCLAUDEmd: boolean
}>()

const emit = defineEmits<{
  done: [payload: { projectPath: string; dbPath: string }]
  skip: []
}>()

const creating = ref(false)
const errorMsg = ref<string | null>(null)
const generateClaudeMd = ref(!props.hasCLAUDEmd)

const projectName = computed(() =>
  props.projectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? props.projectPath
)

const CLAUDE_MD_TEMPLATE = `# CLAUDE.md — ${projectName.value}

## Configuration

\`\`\`
MODE        : solo
LANG_CONV   : français
LANG_CODE   : english
\`\`\`

## Projet

**${projectName.value}** — Décrivez votre projet ici.

## Base de données MCP

\`.claude/settings.json\` :
\`\`\`json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", ".claude/project.db"]
    }
  }
}
\`\`\`
`

async function handleSetup() {
  creating.value = true
  errorMsg.value = null
  try {
    const result = await window.electronAPI.createProjectDb(props.projectPath)
    if (!result.success) {
      errorMsg.value = result.error ?? 'Erreur lors de la création de la base de données'
      return
    }

    if (!props.hasCLAUDEmd && generateClaudeMd.value) {
      const claudeMdPath = `${props.projectPath.replace(/\\/g, '/')}/CLAUDE.md`
      await window.electronAPI.fsWriteFile(claudeMdPath, CLAUDE_MD_TEMPLATE)
    }

    emit('done', { projectPath: props.projectPath, dbPath: result.dbPath })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <!-- Overlay -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden">

      <!-- Header -->
      <div class="px-6 pt-6 pb-4 border-b border-zinc-800">
        <div class="flex items-center gap-3">
          <!-- Icon -->
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            :class="hasCLAUDEmd ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-violet-500/15 border border-violet-500/30'"
          >
            <!-- DB missing icon -->
            <svg v-if="hasCLAUDEmd" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-amber-400">
              <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
            </svg>
            <!-- New project icon -->
            <svg v-else viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5 text-violet-400">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
            </svg>
          </div>
          <div>
            <h2 class="text-base font-semibold text-zinc-100">
              {{ hasCLAUDEmd ? 'Base de données manquante' : 'Nouveau projet' }}
            </h2>
            <p class="text-xs text-zinc-500 mt-0.5 font-mono truncate">{{ projectPath }}</p>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 space-y-4">

        <!-- Case B: CLAUDE.md present, no DB -->
        <template v-if="hasCLAUDEmd">
          <p class="text-sm text-zinc-400 leading-relaxed">
            Ce projet possède un <code class="text-violet-300 bg-zinc-800 px-1 rounded text-xs">CLAUDE.md</code>
            mais aucun fichier <code class="text-violet-300 bg-zinc-800 px-1 rounded text-xs">project.db</code>
            n'a été trouvé dans <code class="text-zinc-300 bg-zinc-800 px-1 rounded text-xs">.claude/</code>.
          </p>
          <div class="px-4 py-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-400 leading-relaxed">
            <p>La base sera créée avec le schéma complet (agents, sessions, tâches, logs, périmètres) et les périmètres par défaut.</p>
          </div>
        </template>

        <!-- Case A: Neither CLAUDE.md nor DB -->
        <template v-else>
          <p class="text-sm text-zinc-400 leading-relaxed">
            Ce dossier ne contient ni
            <code class="text-violet-300 bg-zinc-800 px-1 rounded text-xs">CLAUDE.md</code>
            ni base de données. Initialisez-le en tant que nouveau projet agent-viewer.
          </p>

          <!-- Options -->
          <div class="space-y-2">
            <!-- Always: create DB -->
            <div class="flex items-start gap-3 px-4 py-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 text-violet-400 mt-0.5 shrink-0">
                <path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>
              </svg>
              <div>
                <p class="text-xs font-medium text-zinc-200">Créer <span class="font-mono">.claude/project.db</span></p>
                <p class="text-xs text-zinc-500 mt-0.5">Schéma complet avec périmètres par défaut</p>
              </div>
            </div>

            <!-- Optional: generate CLAUDE.md -->
            <label class="flex items-start gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all"
              :class="generateClaudeMd
                ? 'bg-violet-950/20 border-violet-500/40'
                : 'bg-zinc-800/40 border-zinc-700/50 hover:border-zinc-600'"
            >
              <input
                type="checkbox"
                v-model="generateClaudeMd"
                class="mt-0.5 accent-violet-500 shrink-0"
              />
              <div>
                <p class="text-xs font-medium text-zinc-200">Générer un <span class="font-mono">CLAUDE.md</span> de base</p>
                <p class="text-xs text-zinc-500 mt-0.5">Template minimal — à compléter selon votre projet</p>
              </div>
            </label>
          </div>
        </template>

        <!-- Error -->
        <p v-if="errorMsg" class="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
          {{ errorMsg }}
        </p>
      </div>

      <!-- Footer -->
      <div class="px-6 pb-6 flex items-center justify-between gap-3">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          :disabled="creating"
          @click="emit('skip')"
        >
          Ignorer
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
          :disabled="creating"
          @click="handleSetup"
        >
          <svg v-if="creating" class="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-opacity="0.25"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          {{ creating ? 'Initialisation…' : hasCLAUDEmd ? 'Créer la base de données' : 'Initialiser le projet' }}
        </button>
      </div>

    </div>
  </div>
</template>
