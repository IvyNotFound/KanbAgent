<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AgentGroup } from '@renderer/types'

defineProps<{
  node: { id: string; depth: number; group: AgentGroup }
  isOpened: boolean
  renamingGroupId: number | null
  renameGroupName: string
  creatingSubgroupForId: number | null
  newSubgroupName: string
  isDragTarget: boolean
}>()

const emit = defineEmits<{
  toggle: []
  contextmenu: [event: MouseEvent]
  dragstart: [event: DragEvent]
  dragover: [event: DragEvent]
  dragleave: []
  drop: [event: DragEvent]
  'update:renameGroupName': [value: string]
  confirmRename: []
  cancelRename: []
  'update:newSubgroupName': [value: string]
  confirmCreateSubgroup: []
  cancelCreateSubgroup: []
  startRename: []
  deleteGroup: []
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="group-zone"
    :class="{ 'group-zone--drop': isDragTarget }"
    :style="{ paddingLeft: `${node.depth * 12}px` }"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
    @dragover.prevent="emit('dragover', $event)"
    @dragleave="emit('dragleave')"
    @drop="emit('drop', $event)"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <!-- Group header -->
    <div class="group-header">
      <button
        class="group-header__chevron"
        type="button"
        :aria-expanded="isOpened"
        @click.stop="emit('toggle')"
      >
        <v-icon size="14" :class="{ 'chevron--open': isOpened }">mdi-chevron-right</v-icon>
      </button>

      <!-- Rename input — v-show (not v-if) to avoid element recreation while typing -->
      <v-text-field
        v-show="renamingGroupId === node.group.id"
        :model-value="renameGroupName"
        density="compact"
        variant="outlined"
        hide-details
        autofocus
        class="group-header__rename"
        @update:model-value="emit('update:renameGroupName', $event as string)"
        @keydown.enter="emit('confirmRename')"
        @keydown.esc="emit('cancelRename')"
        @blur="emit('confirmRename')"
      />

      <!-- Group name (dblclick → inline rename) -->
      <span
        v-show="renamingGroupId !== node.group.id"
        class="group-header__name"
        @dblclick="emit('startRename')"
      >{{ node.group.name }}</span>

      <!-- Action buttons — fade in on hover -->
      <div class="group-header__actions">
        <v-btn
          variant="text"
          density="compact"
          size="x-small"
          class="group-action"
          :title="t('sidebar.renameGroup')"
          @click.stop="emit('startRename')"
        ><v-icon size="12">mdi-pencil</v-icon></v-btn>
        <v-btn
          variant="text"
          density="compact"
          size="x-small"
          class="group-action group-action--danger"
          :title="t('sidebar.deleteGroup')"
          @click.stop="emit('deleteGroup')"
        ><v-icon size="12">mdi-delete</v-icon></v-btn>
      </div>
    </div>

    <!-- DnD drop hint -->
    <div v-show="isDragTarget" class="drop-hint text-label-medium">
      {{ t('sidebar.dropAgentHere') }}
    </div>

    <!-- Inline subgroup creation form -->
    <div v-show="creatingSubgroupForId === node.group.id" class="inline-form inline-form--sub mt-1">
      <v-text-field
        :model-value="newSubgroupName"
        density="compact"
        variant="outlined"
        hide-details
        autofocus
        class="inline-form__input"
        :placeholder="t('sidebar.newGroupPlaceholder')"
        @update:model-value="emit('update:newSubgroupName', $event as string)"
        @keydown.enter="emit('confirmCreateSubgroup')"
        @keydown.esc="emit('cancelCreateSubgroup')"
      />
      <v-btn variant="text" density="compact" size="x-small" class="inline-form__btn inline-form__btn--confirm" @click="emit('confirmCreateSubgroup')">✓</v-btn>
      <v-btn variant="text" density="compact" size="x-small" class="inline-form__btn inline-form__btn--cancel" @click="emit('cancelCreateSubgroup')">✕</v-btn>
    </div>
  </div>
</template>

<style scoped>
.group-zone {
  border-radius: 6px;
  margin-bottom: 1px;
  transition: background var(--md-duration-short3, 100ms) var(--md-easing-standard, ease),
              box-shadow var(--md-duration-short3, 100ms) var(--md-easing-standard, ease);
}
.group-zone--drop {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.4);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 28px;
  padding: 2px 2px 2px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--md-duration-short3, 100ms) var(--md-easing-standard, ease);
}
.group-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* Collapse chevron — bare button for accessibility */
.group-header__chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: var(--content-dim);
}
.group-header__chevron .v-icon {
  transition: transform var(--md-duration-short3, 150ms) var(--md-easing-standard, ease);
}
.group-header__chevron .chevron--open {
  transform: rotate(90deg);
}

.group-header__rename {
  flex: 1;
  min-width: 0;
}

.group-header__name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.00625em;
  user-select: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  color: var(--content-subtle);
}

/* Action buttons — fade in on group header hover */
.group-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--md-duration-short3, 100ms) var(--md-easing-standard, ease);
}
.group-header:hover .group-header__actions {
  opacity: 1;
}

.group-action {
  width: 20px !important;
  min-width: 20px !important;
  height: 20px !important;
  min-height: 20px !important;
  padding: 0 !important;
  color: var(--content-dim) !important;
}
.group-action--danger:hover {
  color: rgb(var(--v-theme-error)) !important;
}

/* Drop hint — shown below group header when dragging over */
.drop-hint {
  margin: 2px 4px 4px;
  padding: 4px 0;
  color: rgba(var(--v-theme-primary), 0.7);
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  border-radius: 4px;
}

/* Inline subgroup creation form */
.inline-form {
  display: flex;
  align-items: center;
  gap: 4px;
}
.inline-form--sub {
  padding-left: 20px;
}
.inline-form__input {
  flex: 1;
  min-width: 0;
}
.inline-form__btn {
  min-width: 24px !important;
  min-height: 24px !important;
  width: 24px !important;
  height: 24px !important;
}
.inline-form__btn--confirm { color: rgb(var(--v-theme-secondary)) !important; }
.inline-form__btn--cancel  { color: var(--content-faint) !important; }
</style>
