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

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      class="context-overlay"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        class="context-menu"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @click.stop
      >
        <template v-for="(item, i) in items" :key="i">
          <div v-if="item.separator" class="separator" />
          <button
            v-else
            class="menu-item"
            @click="item.action(); emit('close')"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.context-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
}

.context-menu {
  position: absolute;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  padding: 4px 0;
  min-width: 188px;
}

.separator {
  margin: 4px 0;
  border-top: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 0.6));
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 6px 12px;
  font-size: 0.875rem;
  text-align: left;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: background-color 0.15s, color 0.15s;
}
.menu-item:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.87);
}
</style>
