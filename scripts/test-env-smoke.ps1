param(
  [int]$Port = 4174,
  [string]$BaseUrl = ""
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) {
  $BaseUrl = "http://127.0.0.1:$Port"
}

$env:PORT = [string]$Port
$env:SMOKE_BASE_URL = $BaseUrl

Write-Host "Running writable smoke checks against test environment: $BaseUrl"
& pnpm.cmd run smoke
if ($LASTEXITCODE -ne 0) {
  throw "Smoke checks failed with exit code $LASTEXITCODE"
}
