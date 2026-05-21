param(
  [int]$Port = 4173,
  [string]$DataDir = "data"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "service-common.ps1")

$paths = Get-ServicePaths -DataDir $DataDir
Assert-DataDirSafe -Paths $paths
Initialize-ServiceDirectories -Paths $paths

$identity = Read-ServiceIdentity -Paths $paths
$targetPid = $null

if ($identity) {
  $identityPid = [int]$identity.pid
  if (Test-ProcessAlive -ProcessId $identityPid) {
    $owners = Get-PortOwnerIds -Port $Port
    $health = Test-SkillEvalHealth -Port $Port
    if (($owners -contains $identityPid) -or ($health.Ok -and [int]$health.Health.pid -eq $identityPid)) {
      $targetPid = $identityPid
    } else {
      Write-Warning "Service identity PID $identityPid is alive but does not own a healthy service on port $Port."
      Get-PortOwnerProcesses -Port $Port
      exit 1
    }
  } else {
    Write-Warning "Removing stale service identity for PID $identityPid."
    Remove-ServiceIdentity -Paths $paths
  }
}

if (-not $targetPid) {
  $listeners = Get-PortListeners -Port $Port
  if (-not $listeners) {
    Write-Host "No listening process on port $Port."
    Remove-ServiceIdentity -Paths $paths
    exit 0
  }

  $health = Test-SkillEvalHealth -Port $Port
  if (-not $health.Ok) {
    Write-Warning "Port $Port is listening, but it does not look like Skill Eval. Refusing to stop it."
    $listeners | Select-Object LocalAddress,LocalPort,State,OwningProcess
    Get-PortOwnerProcesses -Port $Port
    exit 1
  }
  $targetPid = [int]$health.Health.pid
}

$process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if ($process) {
  $process | Select-Object Id,ProcessName,StartTime,Path
}
Write-Host "CommandLine: $(Get-ProcessCommandLine -ProcessId $targetPid)"

Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1
$left = Get-PortListeners -Port $Port
if ($left) {
  Write-Warning "Port $Port is still listening after stop attempt:"
  $left | Select-Object LocalAddress,LocalPort,State,OwningProcess
  Get-PortOwnerProcesses -Port $Port
  exit 1
}

Remove-ServiceIdentity -Paths $paths
Write-Host "No listening process on port $Port."
