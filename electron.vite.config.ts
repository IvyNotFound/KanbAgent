import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // SECURITY: GitHub token baked into app.asar at build time.
      // Token is a string literal in resources/app.asar — extractable via:
      //   npx asar extract app.asar app-dir && grep -r "ghp_" app-dir/
      //
      // Required token type: fine-grained PAT with MINIMUM permissions:
      //   - Repository: IvyNotFound/master.md (single repo)
      //   - Permission: Contents → Read-only
      //   (no write access required — all GitHub calls in ipc-settings.ts are GET-only)
      //
      // ROTATION: rotate this token before each release; PATs expire and should
      // not be reused across binaries. Document rotation in the release checklist.
      //
      // Build with: GITHUB_TOKEN=github_pat_xxx npm run build
      // Without it, token is empty string and GitHub features degrade gracefully
      '__BUILT_IN_GITHUB_TOKEN__': JSON.stringify(process.env['GITHUB_TOKEN'] || '')
    }
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
    plugins: [vue()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      // Enable JIT message compilation (interpreter-based, no new Function())
      // Required because Electron CSP blocks 'unsafe-eval' used by the default compiler
      __INTLIFY_JIT_COMPILATION__: true
    }
  }
})
