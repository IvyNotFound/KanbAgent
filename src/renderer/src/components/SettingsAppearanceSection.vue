<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore, type Language, type Theme } from '@renderer/stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const availableLocales = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'no', label: 'Norsk' },
  { code: 'it', label: 'Italiano' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
  { code: 'fi', label: 'Suomi' },
  { code: 'da', label: 'Dansk' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
] as const
</script>

<template>
  <v-sheet rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.language') }}</p>
    <v-select
      :model-value="settingsStore.language"
      :items="availableLocales"
      item-title="label"
      item-value="code"
      variant="outlined"
      density="compact"
      hide-details
      data-testid="lang-select"
      @update:model-value="(v) => settingsStore.setLanguage(v as Language)"
    />
  </v-sheet>
  <v-sheet rounded="lg" border class="pa-4">
    <p class="text-body-2 font-weight-medium mb-2">{{ t('settings.theme') }}</p>
    <v-btn-toggle
      :model-value="settingsStore.theme"
      mandatory
      color="primary"
      variant="outlined"
      density="compact"
      data-testid="theme-toggle"
      @update:model-value="(v) => settingsStore.setTheme(v as Theme)"
    >
      <v-btn value="dark">{{ t('settings.dark') }}</v-btn>
      <v-btn value="light">{{ t('settings.light') }}</v-btn>
    </v-btn-toggle>
  </v-sheet>
</template>
