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
    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-mono max-w-[120px]"
  >
    <span v-if="active" class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
    <span class="truncate">{{ name }}</span>
  </span>
</template>
