#!/usr/bin/env node
/**
 * Downloads the sqlite3.exe precompiled binary from sqlite.org
 * and places it in resources/bin/ for electron-builder to bundle.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const SQLITE_VERSION = '3510200' // 3.51.2
const DOWNLOAD_URL = `https://www.sqlite.org/2026/sqlite-tools-win-x64-${SQLITE_VERSION}.zip`
const DEST_DIR = path.join(__dirname, '..', 'resources', 'bin')
const DEST_FILE = path.join(DEST_DIR, 'sqlite3.exe')
const ZIP_TMP = path.join(DEST_DIR, 'sqlite-tools.zip')

if (fs.existsSync(DEST_FILE)) {
  console.log('sqlite3.exe already present, skipping download.')
  process.exit(0)
}

fs.mkdirSync(DEST_DIR, { recursive: true })

console.log(`Downloading sqlite3.exe from ${DOWNLOAD_URL} ...`)

const file = fs.createWriteStream(ZIP_TMP)

function download(url, dest, cb) {
  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return download(res.headers.location, dest, cb)
    }
    if (res.statusCode !== 200) {
      cb(new Error(`HTTP ${res.statusCode}`))
      return
    }
    res.pipe(dest)
    dest.on('finish', () => dest.close(cb))
  }).on('error', cb)
}

download(DOWNLOAD_URL, file, (err) => {
  if (err) {
    fs.unlink(ZIP_TMP, () => {})
    console.error('Download failed:', err.message)
    process.exit(1)
  }

  console.log('Extracting sqlite3.exe ...')
  try {
    // Use PowerShell to extract on Windows, unzip on Linux/WSL
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${ZIP_TMP}' -DestinationPath '${DEST_DIR}' -Force"`)
    } else {
      execSync(`unzip -o "${ZIP_TMP}" "*/sqlite3.exe" -d "${DEST_DIR}"`)
      // Move from subfolder to root of bin/
      execSync(`find "${DEST_DIR}" -name sqlite3.exe ! -path "${DEST_FILE}" -exec mv {} "${DEST_FILE}" \\;`)
    }
    fs.unlinkSync(ZIP_TMP)
    console.log(`sqlite3.exe extracted to ${DEST_FILE}`)
  } catch (e) {
    console.error('Extraction failed:', e.message)
    process.exit(1)
  }
})
