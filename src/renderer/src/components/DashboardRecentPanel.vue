<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '@renderer/stores/tasks'
import AgentBadge from './AgentBadge.vue'

const { t } = useI18n()
const store = useTasksStore()

interface ActivityRow {
  created_at: string
  action: string
  detail: string | null
  agent_name: string | null
}

const props = defineProps<{
  recentActivity: ActivityRow[]
}>()

const recentTasks = computed(() =>
  [...store.tasks]
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .slice(0, 10)
)

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const STATUT_LABEL = computed<Record<string, string>>(() => ({
  todo: t('status.todo'),
  in_progress: t('status.inProgress'),
  done: t('status.done'),
  archived: t('status.archived'),
}))

function statusColor(status: string): string {
  const map: Record<string, string> = {
    todo: 'default',
    in_progress: 'info',
    done: 'default',
    archived: 'default',
    rejected: 'error',
  }
  return map[status] ?? 'default'
}

function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    low: 'rgb(var(--v-theme-content-subtle))',
    high: 'rgb(var(--v-theme-warning))',
    critical: 'rgb(var(--v-theme-error))',
  }
  return map[priority] ?? 'rgb(var(--v-theme-content-muted))'
}
</script>

<template>
  <v-row class="row-16">
    <!-- Recent tasks -->
    <v-col cols="6">
      <v-card elevation="0" class="metric-card section-card">
        <div class="section-header">
          <span class="text-body-2 font-weight-medium section-title">{{ t('dashboard.recentTasks') }}</span>
        </div>
        <v-list
          v-if="recentTasks.length > 0"
          density="compact"
          bg-color="transparent"
          class="pa-0 section-scroll"
        >
          <v-list-item
            v-for="task in recentTasks"
            :key="task.id"
            :ripple="true"
            class="task-list-item"
            @click="store.openTask(task)"
          >
            <div class="d-flex align-start ga-2 py-1">
              <v-chip
                size="x-small"
                :color="statusColor(task.status)"
                variant="tonal"
                label
                class="shrink-0"
              >
                {{ STATUT_LABEL[task.status] ?? task.status }}
              </v-chip>
              <div class="task-meta-inner">
                <p class="text-caption text-truncate">{{ task.title }}</p>
                <div class="d-flex align-center ga-1 mt-1">
                  <AgentBadge v-if="task.agent_name" :name="task.agent_name" />
                  <span
                    v-if="task.priority && task.priority !== 'normal'"
                    class="text-caption"
                    :style="{ color: priorityColor(task.priority) }"
                  >{{ task.priority }}</span>
                </div>
              </div>
              <span class="shrink-0 text-caption text-disabled tabular-nums ml-auto">
                {{ relativeTime(task.updated_at) }}
              </span>
            </div>
          </v-list-item>
        </v-list>
        <div v-else class="d-flex align-center justify-center pa-8">
          <span class="text-caption text-disabled font-italic">{{ t('dashboard.noTasks') }}</span>
        </div>
      </v-card>
    </v-col>

    <!-- Recent activity -->
    <v-col cols="6">
      <v-card elevation="0" class="metric-card section-card">
        <div class="section-header">
          <span class="text-body-2 font-weight-medium section-title">{{ t('dashboard.recentActivity') }}</span>
        </div>
        <v-list
          v-if="recentActivity.length > 0"
          density="compact"
          bg-color="transparent"
          class="pa-0 section-scroll"
        >
          <v-list-item
            v-for="(entry, i) in recentActivity"
            :key="i"
            class="activity-list-item"
          >
            <div class="d-flex align-start ga-2 py-1">
              <AgentBadge v-if="entry.agent_name" :name="entry.agent_name" class="shrink-0" />
              <span v-else class="text-caption text-disabled agent-label shrink-0">—</span>
              <div class="task-meta-inner">
                <p class="text-caption font-mono">{{ entry.action }}</p>
                <p v-if="entry.detail" class="text-caption text-medium-emphasis text-truncate mt-1">{{ entry.detail }}</p>
              </div>
              <span class="shrink-0 text-caption text-disabled tabular-nums ml-auto">
                {{ relativeTime(entry.created_at) }}
              </span>
            </div>
          </v-list-item>
        </v-list>
        <div v-else class="d-flex align-center justify-center pa-8">
          <span class="text-caption text-disabled font-italic">{{ t('dashboard.noActivity') }}</span>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.metric-card {
  border: 1px solid var(--edge-default) !important;
  background: var(--surface-primary) !important;
  transition: border-color var(--md-duration-short3) var(--md-easing-standard);
}
.metric-card:hover {
  border-color: var(--edge-subtle) !important;
}
.section-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.section-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--edge-default);
}
.section-title {
  color: var(--content-secondary);
}
.section-scroll {
  flex: 1;
  overflow-y: auto;
}
.task-list-item {
  border-bottom: 1px solid var(--edge-default);
  cursor: pointer;
}
.task-list-item:last-child {
  border-bottom: none;
}
.activity-list-item {
  border-bottom: 1px solid var(--edge-default);
}
.activity-list-item:last-child {
  border-bottom: none;
}
.task-meta-inner {
  flex: 1;
  min-width: 0;
}
.agent-label {
  margin-top: 2px;
  white-space: nowrap;
}
.row-16 {
  margin-left: -8px !important;
  margin-right: -8px !important;
}
.row-16 :deep(.v-col) {
  padding-left: 8px !important;
  padding-right: 8px !important;
}
</style>
