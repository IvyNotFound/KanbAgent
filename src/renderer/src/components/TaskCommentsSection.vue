<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { agentFg, agentBg } from '@renderer/utils/agentColor'
import { parseUtcDate } from '@renderer/utils/parseDate'

const { t, locale } = useI18n()

interface RenderedComment {
  id: number
  agent_name: string | null
  created_at: string
  _html: string
}

const props = defineProps<{
  comments: RenderedComment[]
}>()

function relativeTime(iso: string): string {
  const diff = Date.now() - parseUtcDate(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('taskDetail.justNow')
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}j`
}

function formatDateFull(iso: string): string {
  const dateLocale = locale.value === 'fr' ? 'fr-FR' : 'en-US'
  return parseUtcDate(iso).toLocaleString(dateLocale, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="comments-list pa-3 ga-3">
    <div v-for="comment in comments" :key="comment.id">
      <div class="md-bubble text-caption">
        <div class="comment-bubble-header">
          <div class="d-flex align-center ga-2" style="min-width: 0; flex: 1; overflow: hidden;">
            <v-avatar
              size="32"
              :style="{ color: agentFg(comment.agent_name ?? 'unknown'), backgroundColor: agentBg(comment.agent_name ?? 'unknown') }"
              class="text-overline font-weight-bold flex-shrink-0"
            >
              {{ (comment.agent_name ?? '?').slice(0, 2).toUpperCase() }}
            </v-avatar>
            <span class="comment-author">{{ comment.agent_name ?? '?' }}</span>
          </div>
          <span class="comment-time" :title="formatDateFull(comment.created_at)">
            {{ relativeTime(comment.created_at) }}
          </span>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify -->
        <div class="comment-bubble-body" v-html="comment._html"></div>
      </div>
    </div>

    <p v-if="comments.length === 0" class="empty-text text-center py-4 text-caption">
      {{ t('taskDetail.noComments') }}
    </p>
  </div>
</template>

<style scoped>
.comments-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.comment-bubble-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--edge-subtle);
}
.comment-bubble-body {
  padding: 8px 12px;
}
.comment-author {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-time {
  opacity: 0.65;
  flex-shrink: 0;
}
.md-bubble {
  border-radius: var(--shape-sm);
  line-height: 1.5;
  word-break: break-words;
  border: 1px solid var(--edge-subtle);
  background: var(--surface-card);
  color: var(--content-primary);
}
.empty-text {
  color: var(--content-faint);
  font-style: italic;
}
</style>
