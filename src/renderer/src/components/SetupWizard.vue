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
    <v-card class="wizard-card" elevation="3" rounded="xl">

      <!-- Header -->
      <div class="wizard-header d-flex align-center ga-3 px-6 pt-6 pb-4">
        <!-- Icon -->
        <div
          class="wizard-icon d-flex align-center justify-center shrink-0"
          :class="hasCLAUDEmd ? 'wizard-icon--amber' : 'wizard-icon--violet'"
        >
          <!-- DB missing icon — keep color inline as it differs per condition -->
          <v-icon v-if="hasCLAUDEmd" class="wizard-svg" size="20" style="color: rgb(var(--v-theme-warning))">mdi-alert</v-icon>
          <!-- New project icon -->
          <v-icon v-else class="wizard-svg" size="20" style="color: rgb(var(--v-theme-primary))">mdi-folder-outline</v-icon>
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
                <v-icon class="option-icon mt-1 shrink-0" size="16" style="color: rgb(var(--v-theme-primary))">mdi-check</v-icon>
                <div>
                  <p class="text-label-medium text-medium-emphasis">{{ t('setup.createProjectDb', { projectDb: '.claude/project.db' }) }}</p>
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
                  style="accent-color: rgb(var(--v-theme-primary))"
                />
                <div>
                  <p class="text-label-medium text-medium-emphasis">{{ t('setup.generateClaudeMd', { claudeMd: 'CLAUDE.md' }) }}</p>
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
  border-radius: var(--shape-md);
}

.wizard-icon--amber {
  background-color: rgba(var(--v-theme-warning), 0.15);
  border: 1px solid rgba(var(--v-theme-warning), 0.3);
}

.wizard-icon--violet {
  background-color: rgba(var(--v-theme-primary), 0.15);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
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
  border-radius: var(--shape-sm);
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}

.option-box {
  padding: 12px 16px;
  border-radius: var(--shape-sm);
  background: var(--surface-secondary);
  border: 1px solid var(--edge-default);
}

.option-box--clickable {
  cursor: pointer;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard), background-color var(--md-duration-short3) var(--md-easing-standard);
}

.option-box--selected {
  background-color: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.4);
}

.option-icon {
  width: 16px;
  height: 16px;
}
</style>
