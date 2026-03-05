<script setup lang="ts">
import { computed } from 'vue'
import { useUpdater } from '@renderer/composables/useUpdater'

const { status, progress, info, download, install, dismiss } = useUpdater()

const isVisible = computed(
  () =>
    status.value === 'available' ||
    status.value === 'downloading' ||
    status.value === 'downloaded' ||
    status.value === 'error',
)

const versionLabel = computed(() => (info.value?.version ? `v${info.value.version}` : ''))
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-to-class="-translate-y-full opacity-0"
  >
    <div
      v-if="isVisible"
      class="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2 bg-violet-700 text-white text-sm shadow-lg"
    >
      <!-- Available -->
      <template v-if="status === 'available'">
        <span>Mise à jour {{ versionLabel }} disponible</span>
        <button
          class="ml-4 px-3 py-1 bg-white text-violet-700 rounded font-medium hover:bg-violet-100 transition-colors text-xs"
          @click="download"
        >
          Télécharger
        </button>
      </template>

      <!-- Downloading -->
      <template v-else-if="status === 'downloading'">
        <span>Téléchargement en cours…</span>
        <div class="flex items-center gap-2 ml-4">
          <div class="w-32 h-1.5 bg-violet-500 rounded-full overflow-hidden">
            <div
              class="h-full bg-white rounded-full transition-all duration-300"
              :style="{ width: `${progress}%` }"
            />
          </div>
          <span class="text-xs tabular-nums">{{ Math.round(progress) }}%</span>
        </div>
      </template>

      <!-- Downloaded -->
      <template v-else-if="status === 'downloaded'">
        <span>Mise à jour {{ versionLabel }} prête à installer</span>
        <div class="flex items-center gap-2 ml-4">
          <button
            class="px-3 py-1 bg-white text-violet-700 rounded font-medium hover:bg-violet-100 transition-colors text-xs"
            @click="install"
          >
            Redémarrer maintenant
          </button>
          <button
            class="px-2 py-1 text-violet-200 hover:text-white transition-colors text-xs"
            @click="dismiss"
          >
            Plus tard
          </button>
        </div>
      </template>

      <!-- Error -->
      <template v-else-if="status === 'error'">
        <span class="text-red-200">Erreur lors de la mise à jour</span>
        <button
          class="ml-4 text-violet-200 hover:text-white transition-colors text-xs"
          @click="dismiss"
        >
          ✕
        </button>
      </template>
    </div>
  </Transition>
</template>
