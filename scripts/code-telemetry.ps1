$srcPath = "C:\Users\Cover\dev\agent-viewer\src"
$extensions = @("*.ts", "*.vue", "*.css", "*.html", "*.json")

$stats = @{}
$grandTotal = 0
$fileCount = 0
$bigFiles = @()
$testFiles = 0
$testLines = 0
$specFiles = @()

$allFiles = Get-ChildItem -Path $srcPath -Recurse -File | Where-Object { $_.Extension -in @(".ts",".vue",".css",".html",".json") }

foreach ($f in $allFiles) {
    $lines = @(Get-Content $f.FullName -ErrorAction SilentlyContinue).Count
    $ext = $f.Extension
    $fileCount++
    $grandTotal += $lines

    if (-not $stats[$ext]) { $stats[$ext] = @{ count = 0; lines = 0 } }
    $stats[$ext].count++
    $stats[$ext].lines += $lines

    if ($lines -gt 300) {
        $bigFiles += [PSCustomObject]@{ File = $f.FullName.Replace($srcPath, ""); Lines = $lines }
    }

    if ($f.Name -match "\.spec\." -or $f.Name -match "\.test\.") {
        $testFiles++
        $testLines += $lines
        $specFiles += [PSCustomObject]@{ File = $f.Name; Lines = $lines }
    }
}

Write-Host "=== TELEMETRIE CODE agent-viewer/src ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "--- Par extension ---" -ForegroundColor Yellow
foreach ($ext in ($stats.Keys | Sort-Object)) {
    $pct = [math]::Round($stats[$ext].lines / $grandTotal * 100, 1)
    Write-Host ("  {0,-6} : {1,4} fichiers  |  {2,6} lignes  ({3}%)" -f $ext, $stats[$ext].count, $stats[$ext].lines, $pct)
}

Write-Host ""
Write-Host ("  TOTAL  : {0,4} fichiers  |  {1,6} lignes" -f $fileCount, $grandTotal) -ForegroundColor Green

Write-Host ""
Write-Host "--- Tests ---" -ForegroundColor Yellow
$nonTestLines = $grandTotal - $testLines
$testPct = [math]::Round($testLines / $grandTotal * 100, 1)
Write-Host ("  Fichiers de test  : {0} ({1} lignes = {2}% du code)" -f $testFiles, $testLines, $testPct)
Write-Host ("  Code applicatif   : {0} lignes" -f $nonTestLines)

Write-Host ""
Write-Host "--- Fichiers > 300 lignes ---" -ForegroundColor Yellow
if ($bigFiles.Count -eq 0) {
    Write-Host "  Aucun ! Regle 400L respectee partout." -ForegroundColor Green
} else {
    foreach ($bf in ($bigFiles | Sort-Object Lines -Descending)) {
        Write-Host ("  {0,-60} {1} lignes" -f $bf.File, $bf.Lines)
    }
}

Write-Host ""
Write-Host "--- Repartition src/ par dossier ---" -ForegroundColor Yellow
$folders = Get-ChildItem -Path $srcPath -Directory
foreach ($folder in $folders) {
    $fFiles = Get-ChildItem -Path $folder.FullName -Recurse -File | Where-Object { $_.Extension -in @(".ts",".vue") }
    $fLines = 0
    $fCount = 0
    foreach ($ff in $fFiles) {
        $fLines += @(Get-Content $ff.FullName -ErrorAction SilentlyContinue).Count
        $fCount++
    }
    $pct = if ($grandTotal -gt 0) { [math]::Round($fLines / $grandTotal * 100, 1) } else { 0 }
    Write-Host ("  {0,-20} : {1,3} fichiers  |  {2,6} lignes  ({3}%)" -f $folder.Name, $fCount, $fLines, $pct)
}

Write-Host ""
Write-Host "--- Moyenne par fichier ---" -ForegroundColor Yellow
$avgLines = [math]::Round($grandTotal / $fileCount, 0)
Write-Host ("  Moyenne generale  : {0} lignes/fichier" -f $avgLines)
$tsAvg = if ($stats[".ts"].count -gt 0) { [math]::Round($stats[".ts"].lines / $stats[".ts"].count, 0) } else { 0 }
$vueAvg = if ($stats[".vue"].count -gt 0) { [math]::Round($stats[".vue"].lines / $stats[".vue"].count, 0) } else { 0 }
Write-Host ("  Moyenne .ts       : {0} lignes/fichier" -f $tsAvg)
Write-Host ("  Moyenne .vue      : {0} lignes/fichier" -f $vueAvg)
