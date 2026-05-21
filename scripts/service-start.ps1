param(
  [int]$Port = 4173,
  [string]$BindHost = "127.0.0.1",
  [string]$DataDir = "data",
  [string]$LogLevel = "info"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "service-common.ps1")

$paths = Get-ServicePaths -DataDir $DataDir
Assert-DataDirSafe -Paths $paths
Initialize-ServiceDirectories -Paths $paths

$identity = Read-ServiceIdentity -Paths $paths
if ($identity) {
  $identityPid = [int]$identity.pid
  $identityPort = [int]$identity.port
  if ((Test-ProcessAlive -ProcessId $identityPid) -and $identityPort -eq $Port) {
    $health = Test-SkillEvalHealth -Port $Port
    if ($health.Ok -and [int]$health.Health.pid -eq $identityPid) {
      Write-Host "Shared service already running."
      Write-Host "pid: $identityPid"
      Write-Host "url: http://127.0.0.1:$Port"
      Write-Host "log: $($paths.StdoutPath)"
      Write-Host "err: $($paths.StderrPath)"
      exit 0
    }
  }

  if (-not (Test-ProcessAlive -ProcessId $identityPid)) {
    Write-Warning "Removing stale service identity for PID $identityPid."
    Remove-ServiceIdentity -Paths $paths
  } else {
    Write-Warning "Service identity exists but does not match a healthy service on port $Port."
  }
}

$listeners = Get-PortListeners -Port $Port
if ($listeners) {
  Write-Warning "Port $Port already has a listening process. Refusing to start another shared service."
  $listeners | Select-Object LocalAddress,LocalPort,State,OwningProcess
  Get-PortOwnerProcesses -Port $Port
  exit 1
}

Rotate-ServiceLogs -Paths $paths

$env:PORT = [string]$Port
$env:HOST = $BindHost
$env:SKILL_EVAL_DATA_DIR = $DataDir
$env:SKILL_EVAL_RESOURCE_DIR = "resource"
$env:SKILL_EVAL_LOG_LEVEL = $LogLevel

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$process = Start-Process -FilePath $pnpm `
  -ArgumentList @("run", "serve") `
  -WorkingDirectory $paths.RepoRoot `
  -RedirectStandardOutput $paths.StdoutPath `
  -RedirectStandardError $paths.StderrPath `
  -WindowStyle Hidden `
  -PassThru

Write-Host "Started shared service launcher PID $($process.Id) on $BindHost`:$Port"
Write-Host "stdout: $($paths.StdoutPath)"
Write-Host "stderr: $($paths.StderrPath)"

$health = Wait-SkillEvalHealth -Port $Port -TimeoutSeconds 15
if (-not $health.Ok) {
  Write-Warning "Shared service did not answer health checks before the startup timeout: $($health.Error)"
  exit 1
}

$serverPid = [int]$health.Health.pid
Write-ServiceIdentity -Paths $paths -ProcessId $serverPid -Port $Port -BindHost $BindHost -DataDir $DataDir | Out-Null
Write-Host "Shared service is healthy at http://127.0.0.1:$Port"
Write-Host "service pid: $serverPid"
Write-Host "identity: $($paths.IdentityPath)"
