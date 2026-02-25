import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.ivynotfound.agent-viewer',
  productName: 'agent-viewer',
  directories: {
    buildResources: 'build',
    output: 'dist'
  },
  files: ['out/**/*'],
  extraResources: [
    {
      from: 'resources/bin/',
      to: 'bin/',
      filter: ['**/*']
    }
  ],
  mac: { target: 'dmg' },
  win: {
    target: 'nsis'
  },
  nsis: {
    // Adds $INSTDIR\resources\bin to the system PATH so sqlite3.exe is accessible
    // from PowerShell, CMD, and WSL terminals (via Windows interop).
    include: 'build/installer.nsh'
  },
  linux: { target: 'AppImage' }
}

export default config
