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
  <div class="wizard-overlay">
    <v-card class="wizard-card" elevation="8" rounded="xl">

      <!-- Header -->
      <div class="wizard-header d-flex align-center ga-3 px-6 pt-6 pb-4">
        <!-- Icon -->
        <div
          class="wizard-icon d-flex align-center justify-center shrink-0"
          :class="hasCLAUDEmd ? 'wizard-icon--amber' : 'wizard-icon--violet'"
        >
          <!-- DB missing icon -->
          <svg v-if="hasCLAUDEmd" viewBox="0 0 20 20" fill="currentColor" class="wizard-svg" style="color: #fbbf24">
            <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
          </svg>
          <!-- New project icon -->
          <svg v-else viewBox="0 0 20 20" fill="currentColor" class="wizard-svg" style="color: #a78bfa">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
          </svg>
        </div>
        <div class="header-text">
          <h2 class="text-subtitle-1 font-weight-semibold">
            {{ hasCLAUDEmd ? t('setup.missingDb') : t('setup.newProject') }}
          </h2>
          <p class="text-caption text-medium-emphasis font-mono path-label">{{ projectPath }}</p>
        </div>
      </div>

      <v-divider />

      <!-- Body -->
      <v-card-text class="px-6 py-5">
        <div class="d-flex flex-column ga-4">

          <!-- Case B: CLAUDE.md present, no DB -->
          <template v-if="hasCLAUDEmd">
            <p class="text-body-2 text-medium-emphasis">
              {{ t('setup.hasCLAUDEmdDesc', {
                claudeMd: 'CLAUDE.md',
                projectDb: 'project.db',
                claudeDir: '.claude/'
              }) }}
            </p>
            <div class="info-box text-caption text-medium-emphasis">
              <p>{{ t('setup.hasCLAUDEmdInfo') }}</p>
            </div>
          </template>

          <!-- Case A: Neither CLAUDE.md nor DB -->
          <template v-else>
            <p class="text-body-2 text-medium-emphasis">
              {{ t('setup.noFilesDesc', { claudeMd: 'CLAUDE.md' }) }}
            </p>

            <div class="d-flex flex-column ga-2">
              <!-- Always: create DB -->
              <div class="option-box d-flex align-start ga-3">
                <svg viewBox="0 0 16 16" fill="currentColor" class="option-icon mt-1 shrink-0" style="color: #a78bfa">
                  <path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>
                </svg>
                <div>
                  <p class="text-caption font-weight-medium text-medium-emphasis">{{ t('setup.createProjectDb', { projectDb: '.claude/project.db' }) }}</p>
                  <p class="text-caption text-disabled mt-1">{{ t('setup.createProjectDbDesc') }}</p>
                </div>
              </div>

              <!-- Optional: generate CLAUDE.md -->
              <label
                class="option-box option-box--clickable d-flex align-start ga-3"
                :class="{ 'option-box--selected': generateClaudeMd }"
              >
                <input
                  v-model="generateClaudeMd"
                  type="checkbox"
                  class="mt-1 shrink-0"
                  style="accent-color: #7c3aed"
                />
                <div>
                  <p class="text-caption font-weight-medium text-medium-emphasis">{{ t('setup.generateClaudeMd', { claudeMd: 'CLAUDE.md' }) }}</p>
                  <p class="text-caption text-disabled mt-1">{{ t('setup.generateClaudeMdDesc') }}</p>
                </div>
              </label>
            </div>
          </template>

          <!-- Error -->
          <v-alert
            v-if="errorMsg"
            type="error"
            variant="tonal"
            density="compact"
            class="text-caption"
          >{{ errorMsg }}</v-alert>

        </div>
      </v-card-text>

      <!-- Footer -->
      <v-card-actions class="px-6 pb-6">
        <v-btn
          data-testid="btn-skip"
          variant="text"
          size="small"
          :disabled="creating"
          @click="emit('skip')"
        >{{ t('setup.skip') }}</v-btn>
        <v-spacer />
        <v-btn
          data-testid="btn-action"
          color="deep-purple"
          variant="flat"
          :disabled="creating"
          :loading="creating"
          @click="handleSetup"
        >
          {{ creating ? t('setup.creating') : hasCLAUDEmd ? t('setup.createDb') : t('setup.initProject') }}
        </v-btn>
      </v-card-actions>

    </v-card>
  </div>
</template>

<style scoped>
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.wizard-card {
  width: 100%;
  max-width: 448px;
  margin: 0 16px;
  background: var(--surface-primary) !important;
  border: 1px solid var(--edge-default) !important;
}

.wizard-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

.wizard-icon--amber {
  background-color: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.wizard-icon--violet {
  background-color: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.wizard-svg {
  width: 20px;
  height: 20px;
}

.header-text {
  min-width: 0;
  flex: 1;
}

.path-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.info-box {
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}

.option-box {
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}

.option-box--clickable {
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.option-box--selected {
  background-color: rgba(139, 92, 246, 0.08);
  border-color: rgba(139, 92, 246, 0.4);
}

.option-icon {
  width: 16px;
  height: 16px;
}
</style>
