<script setup lang="ts">
import { watch, onUnmounted } from 'vue'

const props = defineProps<{
  modelValue: boolean
  src: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function close() {
  emit('update:modelValue', false)
}

// Document-level Escape listener — works with v-dialog AND in unit tests
let escListener: ((e: KeyboardEvent) => void) | null = null
watch(() => props.modelValue, (open) => {
  if (open && !escListener) {
    escListener = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', escListener)
  } else if (!open && escListener) {
    document.removeEventListener('keydown', escListener)
    escListener = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (escListener) document.removeEventListener('keydown', escListener)
})
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="90vw"
    content-class="image-preview-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div
      v-if="modelValue && src"
      class="d-flex align-center justify-center"
      data-testid="image-preview-container"
      @click.self="close"
    >
      <img
        :src="src"
        alt=""
        class="image-preview-img"
        data-testid="image-preview-img"
      />
    </div>
  </v-dialog>
</template>

<style scoped>
.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
}
</style>
