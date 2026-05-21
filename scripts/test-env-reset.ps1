param(
  [string]$DataDir = ".tmp/test-env-data",
  [string[]]$ResourceFiles = @(
    "gemini_tasks_20260516-20260517.json",
    "Gemini_tasks_20260518-20260519.json"
  ),
  [switch]$NoImages,
  [int]$CacheWorkers = 4
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRootPath = [System.IO.Path]::GetFullPath($repoRoot.Path)
$dataPath = [System.IO.Path]::GetFullPath((Join-Path $repoRootPath $DataDir))
$resourceRoot = Join-Path $repoRootPath "resource"

function Assert-UnderRepoTmp($path) {
  $tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRootPath ".tmp"))
  if (-not $path.StartsWith($tmpRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset test data outside .tmp: $path"
  }
}

Assert-UnderRepoTmp $dataPath

foreach ($file in $ResourceFiles) {
  $resourcePath = Join-Path $resourceRoot $file
  if (-not (Test-Path -LiteralPath $resourcePath -PathType Leaf)) {
    throw "Missing test resource file: $resourcePath"
  }
}

if (Test-Path -LiteralPath $dataPath) {
  Remove-Item -LiteralPath $dataPath -Recurse -Force
}
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null

$env:SKILL_EVAL_DATA_DIR = $DataDir
$env:SKILL_EVAL_RESOURCE_DIR = "resource"
$env:SKILL_EVAL_CACHE_WORKERS = [string]$CacheWorkers

foreach ($file in $ResourceFiles) {
  $args = @("run", "import:resource", "--", "--file=$file", "--cache-workers=$CacheWorkers")
  if ($NoImages) {
    $args += "--no-images"
  }
  Write-Host "Importing test resource: $file"
  & pnpm.cmd @args
  if ($LASTEXITCODE -ne 0) {
    throw "Import failed for $file with exit code $LASTEXITCODE"
  }
}

Write-Host "Test environment data is ready: $dataPath"
