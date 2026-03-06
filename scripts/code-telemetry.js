#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const srcPath = path.resolve(__dirname, '../src');
const EXTENSIONS = new Set(['.ts', '.vue', '.css', '.html', '.json']);
const BIG_FILE_THRESHOLD = 300;

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').length;
}

// Collect stats
const stats = {};
let grandTotal = 0;
let fileCount = 0;
const bigFiles = [];
let testFiles = 0;
let testLines = 0;

const allFiles = walkDir(srcPath);

for (const filePath of allFiles) {
  const ext = path.extname(filePath);
  const name = path.basename(filePath);
  const lines = countLines(filePath);

  fileCount++;
  grandTotal += lines;

  if (!stats[ext]) stats[ext] = { count: 0, lines: 0 };
  stats[ext].count++;
  stats[ext].lines += lines;

  if (lines > BIG_FILE_THRESHOLD) {
    bigFiles.push({ file: filePath.replace(srcPath, ''), lines });
  }

  if (/\.spec\./.test(name) || /\.test\./.test(name)) {
    testFiles++;
    testLines += lines;
  }
}

// Folder breakdown — only .ts and .vue
function getFolderStats(dir) {
  let fLines = 0;
  let fCount = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = getFolderStats(fullPath);
      fLines += sub.fLines;
      fCount += sub.fCount;
    } else if (entry.isFile() && ['.ts', '.vue'].includes(path.extname(entry.name))) {
      fLines += countLines(fullPath);
      fCount++;
    }
  }
  return { fLines, fCount };
}

// Output
const c = {
  cyan:  '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
};

console.log(`${c.cyan}=== TELEMETRIE CODE agent-viewer/src ===${c.reset}`);

console.log(`\n${c.yellow}--- Par extension ---${c.reset}`);
for (const ext of Object.keys(stats).sort()) {
  const pct = ((stats[ext].lines / grandTotal) * 100).toFixed(1);
  console.log(`  ${ext.padEnd(6)} : ${String(stats[ext].count).padStart(4)} fichiers  |  ${String(stats[ext].lines).padStart(6)} lignes  (${pct}%)`);
}

console.log(`\n${c.green}  TOTAL  : ${String(fileCount).padStart(4)} fichiers  |  ${String(grandTotal).padStart(6)} lignes${c.reset}`);

console.log(`\n${c.yellow}--- Tests ---${c.reset}`);
const nonTestLines = grandTotal - testLines;
const testPct = ((testLines / grandTotal) * 100).toFixed(1);
console.log(`  Fichiers de test  : ${testFiles} (${testLines} lignes = ${testPct}% du code)`);
console.log(`  Code applicatif   : ${nonTestLines} lignes`);

console.log(`\n${c.yellow}--- Fichiers > 300 lignes ---${c.reset}`);
if (bigFiles.length === 0) {
  console.log(`${c.green}  Aucun ! Regle 400L respectee partout.${c.reset}`);
} else {
  bigFiles.sort((a, b) => b.lines - a.lines);
  for (const bf of bigFiles) {
    console.log(`  ${bf.file.padEnd(60)} ${bf.lines} lignes`);
  }
}

console.log(`\n${c.yellow}--- Repartition src/ par dossier ---${c.reset}`);
for (const entry of fs.readdirSync(srcPath, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const folderPath = path.join(srcPath, entry.name);
  const { fLines, fCount } = getFolderStats(folderPath);
  const pct = grandTotal > 0 ? ((fLines / grandTotal) * 100).toFixed(1) : '0.0';
  console.log(`  ${entry.name.padEnd(20)} : ${String(fCount).padStart(3)} fichiers  |  ${String(fLines).padStart(6)} lignes  (${pct}%)`);
}

console.log(`\n${c.yellow}--- Moyenne par fichier ---${c.reset}`);
const avgLines = Math.round(grandTotal / fileCount);
console.log(`  Moyenne generale  : ${avgLines} lignes/fichier`);
const tsAvg = stats['.ts']?.count > 0 ? Math.round(stats['.ts'].lines / stats['.ts'].count) : 0;
const vueAvg = stats['.vue']?.count > 0 ? Math.round(stats['.vue'].lines / stats['.vue'].count) : 0;
console.log(`  Moyenne .ts       : ${tsAvg} lignes/fichier`);
console.log(`  Moyenne .vue      : ${vueAvg} lignes/fichier`);
