<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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

## Base de données

\`project.db\` est géré par **KanbAgent** via \`better-sqlite3\` (SQLite natif, WAL mode).
Aucune configuration MCP requise — l'accès est automatique via l'interface.

Accès depuis les agents Claude Code :
\`\`\`bash
# Lecture
node scripts/dbq.js "SELECT id, titre, statut FROM tasks LIMIT 10"

# Écriture
node scripts/dbw.js "UPDATE tasks SET statut='in_progress' WHERE id=1"
\`\`\`

Voir \`.claude/WORKFLOW.md\` pour le protocole complet.
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
      await window.electronAPI.fsWriteFile(claudeMdPath, CLAUDE_MD_TEMPLATE, props.projectPath)
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
    <div class="w-full max-w-md mx-4 bg-surface-primary border border-edge-default/60 rounded-2xl shadow-2xl overflow-hidden">

      <!-- Header -->
      <div class="px-6 pt-6 pb-4 border-b border-edge-subtle">
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
            <h2 class="text-base font-semibold text-content-primary">
              {{ hasCLAUDEmd ? t('setup.missingDb') : t('setup.newProject') }}
            </h2>
            <p class="text-xs text-content-subtle mt-0.5 font-mono truncate">{{ projectPath }}</p>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 space-y-4">

        <!-- Case B: CLAUDE.md present, no DB -->
        <template v-if="hasCLAUDEmd">
          <p class="text-sm text-content-muted leading-relaxed">
            {{ t('setup.hasCLAUDEmdDesc', {
              claudeMd: 'CLAUDE.md',
              projectDb: 'project.db',
              claudeDir: '.claude/'
            }) }}
          </p>
          <div class="px-4 py-3 rounded-lg bg-surface-secondary/60 border border-edge-default/50 text-xs text-content-muted leading-relaxed">
            <p>{{ t('setup.hasCLAUDEmdInfo') }}</p>
          </div>
        </template>

        <!-- Case A: Neither CLAUDE.md nor DB -->
        <template v-else>
          <p class="text-sm text-content-muted leading-relaxed">
            {{ t('setup.noFilesDesc', { claudeMd: 'CLAUDE.md' }) }}
          </p>

          <!-- Options -->
          <div class="space-y-2">
            <!-- Always: create DB -->
            <div class="flex items-start gap-3 px-4 py-3 rounded-lg bg-surface-secondary/60 border border-edge-default/50">
              <svg viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4 text-violet-400 mt-0.5 shrink-0">
                <path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>
              </svg>
              <div>
                <p class="text-xs font-medium text-content-secondary">{{ t('setup.createProjectDb', { projectDb: '.claude/project.db' }) }}</p>
                <p class="text-xs text-content-subtle mt-0.5">{{ t('setup.createProjectDbDesc') }}</p>
              </div>
            </div>

            <!-- Optional: generate CLAUDE.md -->
            <label class="flex items-start gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all"
              :class="generateClaudeMd
                ? 'bg-violet-100 dark:bg-violet-950/20 border-violet-500/40'
                : 'bg-surface-secondary/40 border-edge-default/50 hover:border-content-faint'"
            >
              <input
                v-model="generateClaudeMd"
                type="checkbox"
                class="mt-0.5 accent-violet-500 shrink-0"
              />
              <div>
                <p class="text-xs font-medium text-content-secondary">{{ t('setup.generateClaudeMd', { claudeMd: 'CLAUDE.md' }) }}</p>
                <p class="text-xs text-content-subtle mt-0.5">{{ t('setup.generateClaudeMdDesc') }}</p>
              </div>
            </label>
          </div>
        </template>

        <!-- Error -->
        <p v-if="errorMsg" class="text-xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800/50 rounded px-3 py-2">
          {{ errorMsg }}
        </p>
      </div>

      <!-- Footer -->
      <div class="px-6 pb-6 flex items-center justify-between gap-3">
        <button
          class="text-xs text-content-subtle hover:text-content-tertiary transition-colors disabled:opacity-40"
          :disabled="creating"
          @click="emit('skip')"
        >
          {{ t('setup.skip') }}
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
          {{ creating ? t('setup.creating') : hasCLAUDEmd ? t('setup.createDb') : t('setup.initProject') }}
        </button>
      </div>

    </div>
  </div>
</template>
