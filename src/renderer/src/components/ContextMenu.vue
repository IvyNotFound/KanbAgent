<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

export interface ContextMenuItem {
  label: string
  action: () => void
  separator?: boolean
}

defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

function handleItem(item: ContextMenuItem): void {
  item.action()
  emit('close')
}
</script>

<template>
  <v-menu
    :model-value="true"
    :target="[x, y]"
    :close-on-content-click="false"
    @update:model-value="(v) => !v && emit('close')"
  >
    <v-list density="compact" min-width="188">
      <template v-for="(item, i) in items" :key="i">
        <v-divider v-if="item.separator" />
        <v-list-item
          v-else
          :title="item.label"
          @click="handleItem(item)"
        />
      </template>
    </v-list>
  </v-menu>
</template>
