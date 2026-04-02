<script setup lang="ts">
import { watch, ref, nextTick, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const { pending, accept, cancel } = useConfirmDialog()

const cancelBtn = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)

const isOpen = computed(() => !!pending.value)

// Auto-focus confirm button when dialog opens
watch(pending, (val) => {
  if (val) nextTick(() => confirmBtn.value?.focus())
})

// Document-level Escape listener — works with v-dialog AND in unit tests
let escListener: ((e: KeyboardEvent) => void) | null = null
watch(pending, (val) => {
  if (val && !escListener) {
    escListener = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    document.addEventListener('keydown', escListener)
  } else if (!val && escListener) {
    document.removeEventListener('keydown', escListener)
    escListener = null
  }
})

onUnmounted(() => {
  if (escListener) document.removeEventListener('keydown', escListener)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    const focusable = [cancelBtn.value, confirmBtn.value].filter(Boolean) as HTMLElement[]
    if (focusable.length === 0) return
    const current = document.activeElement
    const idx = focusable.indexOf(current as HTMLElement)
    if (e.shiftKey) {
      const next = idx <= 0 ? focusable[focusable.length - 1] : focusable[idx - 1]
      next.focus()
    } else {
      const next = idx >= focusable.length - 1 ? focusable[0] : focusable[idx + 1]
      next.focus()
    }
    e.preventDefault()
  }
}

const confirmBtnColor = computed(() =>
  pending.value?.options.type === 'danger' ? 'error' :
  pending.value?.options.type === 'warning' ? 'warning' : 'primary'
)
</script>

<template>
  <v-dialog :model-value="isOpen" max-width="420" persistent @update:model-value="cancel">
    <v-card
      v-if="pending"
      role="alertdialog"
      aria-modal="true"
      :aria-label="pending.options.title"
      @keydown="onKeydown"
    >
      <!-- Header with icon -->
      <v-card-text class="pa-5 pb-3">
        <div class="d-flex align-start ga-3">
          <!-- Icon wrapper -->
          <div
            class="icon-wrapper d-flex align-center justify-center"
            :class="[
              pending.options.type === 'danger' ? 'icon-danger' :
              pending.options.type === 'warning' ? 'icon-warning' :
              'icon-info'
            ]"
          >
            <!-- Danger icon -->
            <v-icon v-if="pending.options.type === 'danger'" class="icon-svg icon-svg--danger" size="20">mdi-alert-circle</v-icon>
            <!-- Warning icon -->
            <v-icon v-else-if="pending.options.type === 'warning'" class="icon-svg icon-svg--warning" size="20">mdi-alert</v-icon>
            <!-- Info icon -->
            <v-icon v-else class="icon-svg icon-svg--info" size="20">mdi-information</v-icon>
          </div>

          <div class="flex-grow-1 content-text">
            <h3 class="text-subtitle-2 font-weight-medium">
              {{ pending.options.title }}
            </h3>
            <p class="text-body-2 text-medium-emphasis mt-2">
              {{ pending.options.message }}
            </p>
            <p v-if="pending.options.detail" class="text-caption text-disabled mt-1">
              {{ pending.options.detail }}
            </p>
          </div>
        </div>
      </v-card-text>

      <!-- Actions -->
      <v-card-actions class="px-5 py-4 actions-border">
        <v-spacer />
        <button
          ref="cancelBtn"
          class="btn-cancel"
          @click="cancel"
        >
          {{ pending.options.cancelLabel || t('common.cancel') }}
        </button>
        <button
          ref="confirmBtn"
          class="btn-confirm"
          :class="[
            pending.options.type === 'danger' ? 'btn-confirm--danger'
            : pending.options.type === 'warning' ? 'btn-confirm--warning'
            : 'btn-confirm--info'
          ]"
          @click="accept"
        >
          {{ pending.options.confirmLabel || t('common.confirm') }}
        </button>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  flex-shrink: 0;
}
.icon-danger  { background-color: rgb(239 68 68 / 0.15); }
.icon-warning { background-color: rgb(245 158 11 / 0.15); }
.icon-info    { background-color: rgb(59 130 246 / 0.15); }

.icon-svg {
  width: 18px;
  height: 18px;
}
.icon-svg--danger  { color: rgb(248 113 113); }
.icon-svg--warning { color: rgb(251 191 36); }
.icon-svg--info    { color: rgb(96 165 250); }

.content-text { min-width: 0; }

.actions-border {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.btn-cancel {
  padding: 8px 16px;
  font-size: 0.875rem;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: background-color 0.15s, color 0.15s;
}
.btn-cancel:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.btn-confirm {
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 8px;
  color: #fff;
  transition: background-color 0.15s;
}
.btn-confirm:focus { outline: none; }
.btn-confirm:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.btn-confirm--danger  { background-color: rgb(220 38 38); }
.btn-confirm--danger:hover  { background-color: rgb(239 68 68); }
.btn-confirm--warning { background-color: rgb(217 119 6); }
.btn-confirm--warning:hover { background-color: rgb(245 158 11); }
.btn-confirm--info    { background-color: rgb(37 99 235); }
.btn-confirm--info:hover    { background-color: rgb(59 130 246); }
</style>
