<script setup lang="ts">
import { agentFg, agentBg, agentBorder } from '@renderer/utils/agentColor'

defineProps<{
  name: string
  active?: boolean
}>()
</script>

<template>
  <v-chip
    size="small"
    variant="outlined"
    :style="{
      color: agentFg(name),
      borderColor: agentBorder(name),
      backgroundColor: agentBg(name)
    }"
    :title="name"
    class="agent-chip"
  >
    <span v-if="active" class="activity-dot" />
    <span class="badge-name">{{ name }}</span>
  </v-chip>
</template>

<style scoped>
.activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: rgb(var(--v-theme-secondary));
  flex-shrink: 0;
  display: inline-block;
  margin-right: 4px;
  vertical-align: middle;
}

.badge-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
</style>
