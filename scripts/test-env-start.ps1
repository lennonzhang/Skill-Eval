param(
  [int]$Port = 4174,
  [string]$BindHost = "127.0.0.1",
  [string]$DataDir = ".tmp/test-env-data"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRootPath = [System.IO.Path]::GetFullPath($repoRoot.Path)
$dataPath = [System.IO.Path]::GetFullPath((Join-Path $repoRootPath $DataDir))
$databasePath = Join-Path $dataPath "app.sqlite"

if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
  throw "Test environment database not found at $databasePath. Run pnpm run test-env:reset first."
}

$env:PORT = [string]$Port
$env:HOST = $BindHost
$env:SKILL_EVAL_DATA_DIR = $DataDir
$env:SKILL_EVAL_RESOURCE_DIR = "resource"
$env:SKILL_EVAL_LOG_LEVEL = "debug"

Write-Host "Starting test environment at http://$BindHost`:$Port using $dataPath"
& pnpm.cmd run dev
