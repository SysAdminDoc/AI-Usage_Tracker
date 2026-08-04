param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'ai_usage_tracker_scheduler.py'
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$work = Join-Path $output 'build'
$spec = Join-Path $output 'spec'

New-Item -ItemType Directory -Force -Path $output, $work, $spec | Out-Null
& py -3 -m PyInstaller --onefile --clean --noconfirm `
  --name ai_usage_tracker_scheduler `
  --distpath $output --workpath $work --specpath $spec $source
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

Write-Output (Join-Path $output 'ai_usage_tracker_scheduler.exe')
