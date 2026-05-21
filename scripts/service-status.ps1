param(
  [int]$Port = 4173,
  [string]$DataDir = "data"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "service-common.ps1")

$paths = Get-ServicePaths -DataDir $DataDir
Assert-DataDirSafe -Paths $paths
Initialize-ServiceDirectories -Paths $paths

Write-Host "identity: $($paths.IdentityPath)"
$identity = Read-ServiceIdentity -Paths $paths
if ($identity) {
  Write-Host "identity pid: $($identity.pid)"
  Write-Host "identity port: $($identity.port)"
  Write-Host "identity startedAt: $($identity.startedAt)"
  Write-Host "identity command: $($identity.command)"
  if (-not (Test-ProcessAlive -ProcessId ([int]$identity.pid))) {
    Write-Warning "Service identity is stale; PID $($identity.pid) is not running."
  }
} else {
  Write-Host "identity: none"
}

$connections = Get-PortListeners -Port $Port
if ($connections) {
  Write-Host "Port $Port is listening."
  $connections | Select-Object LocalAddress,LocalPort,State,OwningProcess
  Get-PortOwnerProcesses -Port $Port
} else {
  Write-Host "Port $Port is not listening."
}

$health = Test-SkillEvalHealth -Port $Port
if ($health.Ok) {
  Write-Host "Health: ok=True pid=$($health.Health.pid) test=$($health.Health.test)"
} else {
  Write-Host "Health check failed: $($health.Error)"
}

if ($identity -and $health.Ok -and ([int]$identity.pid -ne [int]$health.Health.pid)) {
  Write-Warning "Identity PID $($identity.pid) does not match health PID $($health.Health.pid)."
}

if ($identity -and $connections) {
  $owners = @(Get-PortOwnerIds -Port $Port)
  if (-not ($owners -contains [int]$identity.pid)) {
    Write-Warning "Identity PID $($identity.pid) is not the owner of port $Port."
  }
}

Write-Host "log: $($paths.StdoutPath)"
Write-Host "err: $($paths.StderrPath)"
Write-Host "archive: $($paths.ArchiveDir)"
