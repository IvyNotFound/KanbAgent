import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), vuetify({ autoImport: true })],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      // Enable JIT message compilation (interpreter-based, no new Function())
      // Required because Electron CSP blocks 'unsafe-eval' used by the default compiler
      __INTLIFY_JIT_COMPILATION__: true
    }
  }
})
