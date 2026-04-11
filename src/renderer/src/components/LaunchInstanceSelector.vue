<script setup lang="ts">
import { CLI_BADGE, CLI_LABELS, systemLabel as getSystemLabel } from '@renderer/utils/cliCapabilities'
import { agentBorder, agentAccent } from '@renderer/utils/agentColor'
import { useI18n } from 'vue-i18n'
import type { CliInstance } from '@shared/cli-types'

const props = defineProps<{
  modelValue: CliInstance | null
  instances: CliInstance[]
  loading: boolean
  agentName: string
  noInstanceText: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CliInstance | null]
}>()

const { t } = useI18n()

function systemLabel(inst: CliInstance): string {
  return getSystemLabel(inst.type, inst.distro)
}
</script>

<template>
  <div>
    <p class="section-title mb-2 text-body-2">{{ t('launch.instance') }}</p>

    <div v-if="loading" class="text-body-2 text-medium-emphasis">{{ t('common.loading') }}</div>

    <div v-else-if="instances.length === 0" class="text-body-2" style="color: var(--content-muted); font-style: italic;">
      {{ noInstanceText }}
    </div>

    <div v-else class="d-flex flex-column ga-2">
      <label
        v-for="inst in instances"
        :key="`${inst.cli}-${inst.distro}`"
        class="instance-row"
        :class="modelValue?.cli === inst.cli && modelValue?.distro === inst.distro ? '' : 'instance-row--idle'"
        :style="modelValue?.cli === inst.cli && modelValue?.distro === inst.distro
          ? { borderColor: agentBorder(agentName), backgroundColor: agentAccent(agentName) + '15' }
          : {}"
      >
        <input
          :model-value="modelValue"
          type="radio"
          :value="inst"
          :style="{ accentColor: agentAccent(agentName) }"
          @change="emit('update:modelValue', inst)"
        />
        <span class="cli-badge">{{ CLI_BADGE[inst.cli] }}</span>
        <span class="instance-label">
          <span style="color: var(--content-muted)">{{ systemLabel(inst) }}</span>
          <span style="color: var(--content-faint); margin: 0 4px;">—</span>
          <span>{{ CLI_LABELS[inst.cli] }}</span>
        </span>
        <span class="version-badge">v{{ inst.version }}</span>
        <span v-if="inst.isDefault && inst.type === 'wsl'" class="default-badge">{{ t('launch.defaultBadge') }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  font-weight: 500;
  color: var(--content-secondary);
}

.instance-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--shape-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--md-duration-short3) var(--md-easing-standard);
}
.instance-row--idle {
  border-color: var(--edge-default);
  background: var(--surface-secondary);
}
.instance-row--idle:hover {
  border-color: var(--content-faint);
}

.cli-badge {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  background: var(--surface-tertiary);
  color: var(--content-muted);
  flex-shrink: 0;
}
.instance-label {
  flex: 1;
  font-size: 14px;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--content-secondary);
}
.version-badge {
  font-size: 10px;
  color: var(--content-subtle);
  font-family: ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace;
  flex-shrink: 0;
}
.default-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--surface-tertiary);
  color: var(--content-muted);
  flex-shrink: 0;
}
</style>
