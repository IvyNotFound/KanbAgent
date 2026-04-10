<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { CLI_LABELS } from '@renderer/utils/cliCapabilities'
import type { CliType } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'

const { t } = useI18n()
const settingsStore = useSettingsStore()

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

// ── Language selector ──────────────────────────────────────────────────────────
const LANG_OPTIONS: { value: string; title: string }[] = [
  { value: 'en', title: 'English' },
  { value: 'fr', title: 'Fran\u00e7ais' },
  { value: 'es', title: 'Espa\u00f1ol' },
  { value: 'pt', title: 'Portugu\u00eas' },
  { value: 'pt-BR', title: 'Portugu\u00eas (Brasil)' },
  { value: 'de', title: 'Deutsch' },
  { value: 'it', title: 'Italiano' },
  { value: 'ja', title: '\u65e5\u672c\u8a9e' },
  { value: 'ko', title: '\ud55c\uad6d\uc5b4' },
  { value: 'zh-CN', title: '\u4e2d\u6587' },
  { value: 'ru', title: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  { value: 'pl', title: 'Polski' },
  { value: 'sv', title: 'Svenska' },
  { value: 'fi', title: 'Suomi' },
  { value: 'da', title: 'Dansk' },
  { value: 'no', title: 'Norsk' },
  { value: 'tr', title: 'T\u00fcrk\u00e7e' },
  { value: 'ar', title: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
]

const selectedLang = ref('en')

// ── CLI + model selectors ──────────────────────────────────────────────────────
const primaryCli = ref<string | null>(null)
const primaryModel = ref('')
const additionalClis = ref<string[]>([])
const modelPerCli = ref<Record<string, string>>({})
const generateInstructions = ref(!props.hasCLAUDEmd)

const cliItems = computed(() => {
  const seen = new Set<string>()
  for (const inst of settingsStore.allCliInstances) {
    if (settingsStore.enabledClis.includes(inst.cli as CliType)) seen.add(inst.cli)
  }
  return Array.from(seen).map(cli => ({ title: CLI_LABELS[cli as CliType] ?? cli, value: cli }))
})

const effectivePrimaryCli = computed<CliType>(() =>
  (primaryCli.value as CliType) ?? settingsStore.primaryCli
)

const availablePrimaryModels = computed(() => {
  const models: CliModelDef[] = settingsStore.cliModels[effectivePrimaryCli.value] ?? []
  return models.map(m => ({ title: m.label, value: m.modelId }))
})

const defaultPrimaryModelLabel = computed(() => {
  const modelId = settingsStore.getDefaultModel(effectivePrimaryCli.value)
  if (!modelId) return null
  const models: CliModelDef[] = settingsStore.cliModels[effectivePrimaryCli.value] ?? []
  return models.find(m => m.modelId === modelId)?.label ?? modelId
})

const otherAvailableClis = computed(() =>
  cliItems.value.filter(c => c.value !== effectivePrimaryCli.value)
)

function modelsForCli(cli: string): { title: string; value: string }[] {
  const models: CliModelDef[] = settingsStore.cliModels[cli as CliType] ?? []
  return models.map(m => ({ title: m.label, value: m.modelId }))
}

function toggleAdditionalCli(cli: string, checked: boolean) {
  if (checked) {
    if (!additionalClis.value.includes(cli)) additionalClis.value.push(cli)
  } else {
    additionalClis.value = additionalClis.value.filter(c => c !== cli)
  }
}

// Reset primary model when primary CLI changes
const mounted = ref(false)
watch(effectivePrimaryCli, (newCli) => {
  if (mounted.value) {
    primaryModel.value = ''
    // Remove from additional if it was checked
    additionalClis.value = additionalClis.value.filter(c => c !== newCli)
  }
})

onMounted(async () => {
  if (settingsStore.allCliInstances.length === 0) {
    await settingsStore.refreshCliDetection()
  }
  if (Object.keys(settingsStore.cliModels).length === 0) {
    await settingsStore.loadCliModels()
  }
  mounted.value = true
})

const projectName = computed(() =>
  props.projectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? props.projectPath
)

async function handleSetup() {
  creating.value = true
  errorMsg.value = null
  try {
    // 1. Create DB with language
    const result = await window.electronAPI.createProjectDb(props.projectPath, selectedLang.value)
    if (!result.success) {
      errorMsg.value = result.error ?? t('setup.createDbError')
      return
    }

    // 2. Generate instruction files for all selected CLIs
    if (generateInstructions.value) {
      const allClis = [effectivePrimaryCli.value, ...additionalClis.value]
      await window.electronAPI.initNewProject(
        props.projectPath,
        selectedLang.value,
        allClis,
        effectivePrimaryCli.value,
      )
    }

    // 3. Persist CLI + model defaults
    if (primaryCli.value) {
      await window.electronAPI.setConfigValue(result.dbPath, 'defaultCliInstance', primaryCli.value)
    }
    if (primaryModel.value.trim()) {
      await window.electronAPI.setConfigValue(
        result.dbPath, `default_model_${effectivePrimaryCli.value}`, primaryModel.value.trim()
      )
    }
    for (const cli of additionalClis.value) {
      const model = modelPerCli.value[cli]
      if (model?.trim()) {
        await window.electronAPI.setConfigValue(result.dbPath, `default_model_${cli}`, model.trim())
      }
    }

    // 4. Persist project_clis and primary_cli config
    const allClis = [effectivePrimaryCli.value, ...additionalClis.value]
    await window.electronAPI.setConfigValue(result.dbPath, 'project_clis', JSON.stringify(allClis))
    await window.electronAPI.setConfigValue(result.dbPath, 'primary_cli', effectivePrimaryCli.value)

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
        <div
          class="wizard-icon d-flex align-center justify-center shrink-0"
          :class="hasCLAUDEmd ? 'wizard-icon--amber' : 'wizard-icon--violet'"
        >
          <v-icon v-if="hasCLAUDEmd" class="wizard-svg" size="20" style="color: rgb(var(--v-theme-warning))">mdi-alert</v-icon>
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

              <!-- Optional: generate instruction files -->
              <label
                class="option-box option-box--clickable d-flex align-start ga-3"
                :class="{ 'option-box--selected': generateInstructions }"
              >
                <input
                  v-model="generateInstructions"
                  type="checkbox"
                  class="mt-1 shrink-0"
                  style="accent-color: rgb(var(--v-theme-primary))"
                />
                <div>
                  <p class="text-label-medium text-medium-emphasis">{{ t('setup.generateInstructions') }}</p>
                  <p class="text-caption text-disabled mt-1">{{ t('setup.generateInstructionsDesc') }}</p>
                </div>
              </label>
            </div>
          </template>

          <!-- Language selector -->
          <v-select
            v-model="selectedLang"
            :items="LANG_OPTIONS"
            :label="t('setup.instructionLang')"
            :hint="t('setup.instructionLangNote')"
            persistent-hint
            variant="outlined"
            density="compact"
            color="primary"
          />

          <!-- Primary CLI + model (shared between Case A and B) -->
          <div v-if="cliItems.length > 0" class="d-flex flex-column ga-3">
            <v-select
              v-model="primaryCli"
              :items="cliItems"
              :label="t('setup.defaultCli')"
              :placeholder="t('agent.globalDefault')"
              :hint="t('setup.defaultCliNote')"
              persistent-hint
              clearable
              variant="outlined"
              density="compact"
              color="primary"
            />
            <v-select
              v-if="availablePrimaryModels.length > 0"
              v-model="primaryModel"
              :items="availablePrimaryModels"
              :label="t('setup.defaultModel')"
              clearable
              :placeholder="defaultPrimaryModelLabel ? t('agent.settingsDefaultNamed', { model: defaultPrimaryModelLabel }) : t('agent.settingsDefault')"
              :hint="t('setup.defaultModelNote')"
              persistent-hint
              variant="outlined"
              density="compact"
              color="primary"
            />
            <v-text-field
              v-else
              v-model="primaryModel"
              :label="t('setup.defaultModel')"
              placeholder="anthropic/claude-opus-4-5"
              :hint="t('setup.defaultModelNote')"
              persistent-hint
              variant="outlined"
              density="compact"
            />

            <!-- Additional CLIs -->
            <div v-if="otherAvailableClis.length > 0" class="d-flex flex-column ga-2">
              <p class="text-label-medium text-medium-emphasis">{{ t('setup.additionalClis') }}</p>
              <div v-for="cli in otherAvailableClis" :key="cli.value" class="additional-cli-row d-flex align-center ga-3">
                <v-checkbox
                  :model-value="additionalClis.includes(cli.value)"
                  :label="cli.title"
                  @update:model-value="toggleAdditionalCli(cli.value, !!$event)"
                  density="compact"
                  hide-details
                  color="primary"
                  class="shrink-0"
                />
                <v-select
                  v-if="additionalClis.includes(cli.value) && modelsForCli(cli.value).length > 0"
                  v-model="modelPerCli[cli.value]"
                  :items="modelsForCli(cli.value)"
                  :label="t('setup.defaultModel')"
                  clearable
                  variant="outlined"
                  density="compact"
                  color="primary"
                  hide-details
                  class="flex-grow-1"
                />
              </div>
            </div>
          </div>

          <!-- Generate instructions checkbox for Case B -->
          <label
            v-if="hasCLAUDEmd"
            class="option-box option-box--clickable d-flex align-start ga-3"
            :class="{ 'option-box--selected': generateInstructions }"
          >
            <input
              v-model="generateInstructions"
              type="checkbox"
              class="mt-1 shrink-0"
              style="accent-color: rgb(var(--v-theme-primary))"
            />
            <div>
              <p class="text-label-medium text-medium-emphasis">{{ t('setup.generateInstructions') }}</p>
              <p class="text-caption text-disabled mt-1">{{ t('setup.generateInstructionsDesc') }}</p>
            </div>
          </label>

          <!-- Error -->
          <v-alert
            v-if="errorMsg"
            type="error"
            variant="tonal"
            density="compact"
            class="text-caption"
          >
{{ errorMsg }}
</v-alert>
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
        >
{{ t('setup.skip') }}
</v-btn>
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
  max-width: 480px;
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

.additional-cli-row {
  min-height: 40px;
}
</style>
