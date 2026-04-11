<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CliType } from '@shared/cli-types'

const { t } = useI18n()

const props = defineProps<{
  primaryCli: string | null
  primaryModel: string
  additionalClis: string[]
  modelPerCli: Record<string, string>
  cliItems: Array<{ title: string; value: string }>
  availablePrimaryModels: Array<{ title: string; value: string }>
  otherAvailableClis: Array<{ title: string; value: string }>
  defaultPrimaryModelLabel: string | null
  modelsForCli: (cli: string) => Array<{ title: string; value: string }>
}>()

const emit = defineEmits<{
  (e: 'update:primaryCli', value: string | null): void
  (e: 'update:primaryModel', value: string): void
  (e: 'update:additionalClis', value: string[]): void
  (e: 'update:modelPerCli', value: Record<string, string>): void
}>()

function toggleAdditionalCli(cli: string, checked: boolean) {
  if (checked) {
    if (!props.additionalClis.includes(cli)) emit('update:additionalClis', [...props.additionalClis, cli])
  } else {
    emit('update:additionalClis', props.additionalClis.filter(c => c !== cli))
  }
}

function setModelPerCli(cli: string, value: string) {
  emit('update:modelPerCli', { ...props.modelPerCli, [cli]: value })
}
</script>

<template>
  <div v-if="cliItems.length > 0" class="d-flex flex-column ga-3">
    <v-select
      :model-value="primaryCli"
      :items="cliItems"
      :label="t('setup.defaultCli')"
      :placeholder="t('agent.globalDefault')"
      :hint="t('setup.defaultCliNote')"
      persistent-hint
      clearable
      variant="outlined"
      density="compact"
      color="primary"
      @update:model-value="emit('update:primaryCli', $event as string | null)"
    />
    <v-select
      v-if="availablePrimaryModels.length > 0"
      :model-value="primaryModel"
      :items="availablePrimaryModels"
      :label="t('setup.defaultModel')"
      clearable
      :placeholder="defaultPrimaryModelLabel ? t('agent.settingsDefaultNamed', { model: defaultPrimaryModelLabel }) : t('agent.settingsDefault')"
      :hint="t('setup.defaultModelNote')"
      persistent-hint
      variant="outlined"
      density="compact"
      color="primary"
      @update:model-value="emit('update:primaryModel', ($event as string) ?? '')"
    />
    <v-text-field
      v-else
      :model-value="primaryModel"
      :label="t('setup.defaultModel')"
      placeholder="anthropic/claude-opus-4-5"
      :hint="t('setup.defaultModelNote')"
      persistent-hint
      variant="outlined"
      density="compact"
      @update:model-value="emit('update:primaryModel', $event as string)"
    />

    <!-- Additional CLIs -->
    <div v-if="otherAvailableClis.length > 0" class="d-flex flex-column ga-2">
      <p class="text-label-medium text-medium-emphasis">{{ t('setup.additionalClis') }}</p>
      <div v-for="cli in otherAvailableClis" :key="cli.value" class="additional-cli-row d-flex align-center ga-3">
        <v-checkbox
          :model-value="additionalClis.includes(cli.value)"
          :label="cli.title"
          density="compact"
          hide-details
          color="primary"
          class="shrink-0"
          @update:model-value="toggleAdditionalCli(cli.value, !!$event)"
        />
        <v-select
          v-if="additionalClis.includes(cli.value) && modelsForCli(cli.value).length > 0"
          :model-value="modelPerCli[cli.value]"
          :items="modelsForCli(cli.value)"
          :label="t('setup.defaultModel')"
          clearable
          variant="outlined"
          density="compact"
          color="primary"
          hide-details
          class="flex-grow-1"
          @update:model-value="setModelPerCli(cli.value, ($event as string) ?? '')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.additional-cli-row {
  min-height: 40px;
}
</style>
