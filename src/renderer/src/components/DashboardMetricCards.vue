<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  activeAgentsCount: number
  inProgressCount: number
  todoCount: number
  sessionsTodayCount: number
}>()
</script>

<template>
  <v-row class="row-16">
    <!-- Active agents -->
    <v-col cols="3">
      <v-card elevation="1" class="metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="metric-icon metric-icon--cyan shrink-0">
            <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-secondary))">mdi-account-group</v-icon>
          </div>
          <div class="metric-values">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ activeAgentsCount }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.activeAgents') }}</div>
            <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.sessionsStarted') }}</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- In-progress tasks -->
    <v-col cols="3">
      <v-card elevation="1" class="metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="metric-icon metric-icon--amber shrink-0">
            <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-warning))">mdi-lightning-bolt</v-icon>
          </div>
          <div class="metric-values">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ inProgressCount }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.inProgress') }}</div>
            <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.activeTasks') }}</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Todo tasks -->
    <v-col cols="3">
      <v-card elevation="1" class="metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="metric-icon metric-icon--violet shrink-0">
            <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-primary))">mdi-clipboard-text-outline</v-icon>
          </div>
          <div class="metric-values">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ todoCount }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.todo') }}</div>
            <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.pendingTasks') }}</div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Sessions today -->
    <v-col cols="3">
      <v-card elevation="1" class="metric-card">
        <v-card-text class="d-flex align-center ga-3 pa-4">
          <div class="metric-icon metric-icon--emerald shrink-0">
            <v-icon class="metric-svg" size="20" style="color: rgb(var(--v-theme-info))">mdi-calendar-today</v-icon>
          </div>
          <div class="metric-values">
            <div class="text-h6 font-weight-bold tabular-nums lh-tight">{{ sessionsTodayCount }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">{{ t('dashboard.today') }}</div>
            <div class="metric-sublabel text-truncate text-label-medium">{{ t('dashboard.sessionsStarted') }}</div>
          </div>
        </v-card-text>
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
.metric-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--shape-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.metric-icon--cyan    { background-color: rgba(var(--v-theme-secondary), 0.15); }
.metric-icon--amber   { background-color: rgba(var(--v-theme-warning), 0.15); }
.metric-icon--violet  { background-color: rgba(var(--v-theme-primary), 0.15); }
.metric-icon--emerald { background-color: rgba(var(--v-theme-info), 0.15); }
.metric-svg {
  width: 16px;
  height: 16px;
}
.metric-values {
  min-width: 0;
}
.metric-sublabel {
  color: var(--content-tertiary);
}
.lh-tight {
  line-height: 1.2;
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
