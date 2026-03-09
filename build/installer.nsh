; installer.nsh — NSIS custom hooks for KanbAgent
; Adds/removes $INSTDIR\resources\bin from the system PATH
; so that sqlite3.exe is available in CMD, PowerShell, and WSL (via Windows interop).
; Uses PowerShell instead of the EnVar plugin (not bundled with electron-builder).

!macro customInstall
  ; Add resources\bin to system PATH via PowerShell (idempotent)
  nsExec::ExecToLog 'powershell.exe -NoProfile -Command "$$p=[Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\"); if($$p -notlike \"*$INSTDIR\resources\bin*\"){[Environment]::SetEnvironmentVariable(\"PATH\",$$p+\";$INSTDIR\resources\bin\",\"Machine\")}"'
  Pop $0
  DetailPrint "PATH update result: $0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  ; Remove resources\bin from system PATH via PowerShell
  nsExec::ExecToLog 'powershell.exe -NoProfile -Command "$$p=[Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\"); [Environment]::SetEnvironmentVariable(\"PATH\",($$p.Split(\";\") | Where-Object{$$_ -ne \"$INSTDIR\resources\bin\"}) -join \";\",\"Machine\")"'
  Pop $0
  DetailPrint "PATH cleanup result: $0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
