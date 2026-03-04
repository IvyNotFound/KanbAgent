<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TaskNode } from '@renderer/utils/taskTree'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'
import { perimeterFg, perimeterBg, perimeterBorder } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'

const { locale } = useI18n()

const props = defineProps<{
  node: TaskNode
}>()

const store = useTasksStore()

const expanded = ref(true)
const hasChildren = computed(() => props.node.children.length > 0)

function toggle(): void {
  if (hasChildren.value) expanded.value = !expanded.value
}

function formatDate(iso: string): string {
  const loc = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const EFFORT_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' }
const EFFORT_BADGE: Record<number, string> = {
  1: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  2: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  3: 'bg-red-500/20 text-red-400 border-red-500/30',
}
</script>

<template>
  <div class="flex flex-col">
    <!-- Node row -->
    <div
      :class="[
        'flex items-start gap-1.5 group/node rounded-lg px-2 py-1.5 hover:bg-surface-secondary transition-colors cursor-pointer',
        node.depth > 0 && 'ml-4 border-l border-edge-subtle pl-3',
      ]"
      @click="store.openTask(node)"
    >
      <!-- Expand/collapse toggle -->
      <button
        v-if="hasChildren"
        class="shrink-0 w-4 h-4 flex items-center justify-center text-content-subtle hover:text-content-tertiary transition-colors mt-0.5"
        :title="expanded ? 'Réduire' : 'Développer'"
        @click.stop="toggle"
      >
        <svg
          :class="['w-3 h-3 transition-transform duration-150', expanded ? 'rotate-90' : '']"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <!-- Leaf spacer -->
      <span v-else class="shrink-0 w-4" />

      <!-- Card content -->
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <!-- Title row -->
        <div class="flex items-start gap-2">
          <p class="text-sm text-content-primary font-medium leading-snug flex-1 min-w-0 break-words group-hover/node:text-content-primary transition-colors">
            {{ node.titre }}
          </p>
          <!-- Badges -->
          <div class="flex items-center gap-1 shrink-0">
            <span
              v-if="node.effort"
              :class="['text-xs font-bold px-1 py-0.5 rounded font-mono border text-[10px]', EFFORT_BADGE[node.effort]]"
            >{{ EFFORT_LABEL[node.effort] }}</span>
            <span class="text-[10px] text-content-faint font-mono">#{{ node.id }}</span>
          </div>
        </div>

        <!-- Meta: perimetre + agent + date -->
        <div class="flex items-center gap-1.5 flex-wrap">
          <span
            v-if="node.perimetre"
            class="text-[10px] px-1 py-0 rounded font-mono border"
            :style="{
              color: perimeterFg(node.perimetre),
              backgroundColor: perimeterBg(node.perimetre),
              borderColor: perimeterBorder(node.perimetre),
            }"
          >{{ node.perimetre }}</span>
          <AgentBadge v-if="node.agent_name" :name="node.agent_name" :perimetre="node.agent_perimetre" class="text-[10px]" />
          <span class="text-[10px] text-content-muted font-mono ml-auto">{{ formatDate(node.updated_at) }}</span>
        </div>

        <!-- Children count hint when collapsed -->
        <p v-if="hasChildren && !expanded" class="text-[10px] text-content-subtle italic">
          {{ node.children.length }} sous-tâche{{ node.children.length > 1 ? 's' : '' }}
        </p>
      </div>
    </div>

    <!-- Recursive children -->
    <div v-if="hasChildren && expanded" class="flex flex-col gap-0.5 mt-0.5">
      <TaskTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
      />
    </div>
  </div>
</template>
