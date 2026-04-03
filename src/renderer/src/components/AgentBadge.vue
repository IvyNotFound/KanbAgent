<script setup lang="ts">
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

defineProps<{
  name: string
  active?: boolean
}>()
</script>

<template>
  <span
    :style="{
      color: agentFg(name),
      backgroundColor: agentBg(name),
      borderColor: agentBorder(name)
    }"
    :title="name"
    class="agent-badge"
  >
    <span v-if="active" class="activity-dot"></span>
    <span class="badge-name">{{ name }}</span>
  </span>
</template>

<style scoped>
.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  border-width: 1px;
  border-style: solid;
  font-family: monospace;
  max-width: 200px;
}

.activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: rgb(52 211 153); /* emerald-400 */
  flex-shrink: 0;
}

.badge-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
