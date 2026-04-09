<script setup lang="ts">
/**
 * PermissionRequestBanner — sticky banner displayed above StreamInputBar
 * when a CLI agent requests permission to run a tool (T1817).
 *
 * Shows: tool name, collapsible tool arguments, Allow/Deny buttons.
 * Emits: respond(permissionId, behavior) to parent.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface PendingPermission {
  permission_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}

const props = defineProps<{
  permission: PendingPermission
  accentFg: string
  accentText: string
}>()

const emit = defineEmits<{
  respond: [permissionId: string, behavior: 'allow' | 'deny']
}>()

const { t } = useI18n()
const showArgs = ref(false)

function formatToolInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ''
  // For Bash commands, show the command directly
  if (typeof input.command === 'string') return input.command
  // For other tools, show JSON
  return JSON.stringify(input, null, 2)
}

const formattedInput = formatToolInput(props.permission.tool_input)
const isLongInput = formattedInput.split('\n').length > 5 || formattedInput.length > 200
</script>

<template>
  <div
    class="permission-banner px-5 py-3 d-flex flex-column ga-2"
    data-testid="permission-request-banner"
  >
    <!-- Header row: icon + title + tool name -->
    <div class="d-flex align-center ga-2">
      <v-icon icon="mdi-shield-lock-outline" size="small" :style="{ color: accentText }" />
      <span class="text-caption font-weight-medium" :style="{ color: accentText }">
        {{ t('stream.permissionRequired') }}
      </span>
      <v-chip
        size="x-small"
        variant="tonal"
        :color="accentFg"
        class="ml-1"
      >
        {{ permission.tool_name }}
      </v-chip>
    </div>

    <!-- Tool arguments (collapsible for long content) -->
    <div v-if="formattedInput" class="permission-args">
      <button
        v-if="isLongInput"
        class="args-toggle text-caption"
        data-testid="permission-args-toggle"
        @click="showArgs = !showArgs"
      >
        {{ showArgs ? t('stream.permissionHideArgs') : t('stream.permissionShowArgs') }}
      </button>
      <pre
        v-if="!isLongInput || showArgs"
        class="args-content text-caption mt-1"
        data-testid="permission-args-content"
      >{{ formattedInput }}</pre>
    </div>

    <!-- Action buttons -->
    <div class="d-flex ga-2">
      <v-btn
        size="small"
        variant="flat"
        color="success"
        data-testid="permission-allow-btn"
        @click="emit('respond', permission.permission_id, 'allow')"
      >
        <v-icon icon="mdi-check" size="small" class="mr-1" />
        {{ t('stream.permissionAllow') }}
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        color="error"
        data-testid="permission-deny-btn"
        @click="emit('respond', permission.permission_id, 'deny')"
      >
        <v-icon icon="mdi-close" size="small" class="mr-1" />
        {{ t('stream.permissionDeny') }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.permission-banner {
  background: var(--surface-secondary);
  border-top: 1px solid var(--edge-subtle);
}

.args-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-decoration: underline;
}
.args-toggle:hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.args-content {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
</style>
