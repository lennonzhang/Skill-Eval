$ServiceCommand = "pnpm run serve"
$ServiceIdentityFileName = "service.pid.json"
$CurrentLogFileName = "server.log"
$CurrentErrLogFileName = "server.err.log"
$MaxArchivedLogPairs = 10

function Get-RepoRoot {
  return [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..")).Path)
}

function Resolve-ServiceDataPath {
  param(
    [string]$RepoRoot,
    [string]$DataDir
  )
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $DataDir))
}

function Get-ServicePaths {
  param(
    [string]$DataDir = "data"
  )

  $repoRoot = Get-RepoRoot
  $dataPath = Resolve-ServiceDataPath -RepoRoot $repoRoot -DataDir $DataDir
  $logsDir = Join-Path $dataPath "logs"
  $archiveDir = Join-Path $logsDir "archive"
  return [pscustomobject]@{
    RepoRoot = $repoRoot
    DataDir = $DataDir
    DataPath = $dataPath
    LogsDir = $logsDir
    ArchiveDir = $archiveDir
    IdentityPath = Join-Path $dataPath $ServiceIdentityFileName
    StdoutPath = Join-Path $logsDir $CurrentLogFileName
    StderrPath = Join-Path $logsDir $CurrentErrLogFileName
  }
}

function Assert-DataDirSafe {
  param(
    [object]$Paths
  )

  $repoRoot = [System.IO.Path]::GetFullPath($Paths.RepoRoot)
  $dataPath = [System.IO.Path]::GetFullPath($Paths.DataPath)
  if (-not $dataPath.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to manage service data outside repository root: $dataPath"
  }
}

function Initialize-ServiceDirectories {
  param(
    [object]$Paths
  )

  New-Item -ItemType Directory -Path $Paths.DataPath -Force | Out-Null
  New-Item -ItemType Directory -Path $Paths.LogsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $Paths.ArchiveDir -Force | Out-Null
}

function Get-PortListeners {
  param(
    [int]$Port
  )

  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}

function Get-PortOwnerIds {
  param(
    [int]$Port
  )

  $listeners = Get-PortListeners -Port $Port
  if (-not $listeners) {
    return @()
  }
  return @($listeners.OwningProcess | Sort-Object -Unique)
}

function Get-PortOwnerProcesses {
  param(
    [int]$Port
  )

  $owners = Get-PortOwnerIds -Port $Port
  foreach ($owner in $owners) {
    Get-Process -Id $owner -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime,Path
  }
}

function Get-ProcessCommandLine {
  param(
    [int]$ProcessId
  )

  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($record) {
    return [string]$record.CommandLine
  }
  return ""
}

function Test-ProcessAlive {
  param(
    [int]$ProcessId
  )

  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-SkillEvalHealth {
  param(
    [int]$Port
  )

  $baseUrl = "http://127.0.0.1:$Port"
  try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method Get -TimeoutSec 2
    if (-not $health.ok) {
      return [pscustomobject]@{ Ok = $false; Health = $health; Error = "Health API did not return ok=true"; HtmlOk = $false }
    }
    $html = Invoke-WebRequest -Uri $baseUrl -Method Get -TimeoutSec 2
    $htmlOk = $html.Content -like "*Skill Eval Review*"
    return [pscustomobject]@{ Ok = $htmlOk; Health = $health; Error = $(if ($htmlOk) { $null } else { "Review HTML did not match Skill Eval" }); HtmlOk = $htmlOk }
  } catch {
    return [pscustomobject]@{ Ok = $false; Health = $null; Error = $_.Exception.Message; HtmlOk = $false }
  }
}

function Wait-SkillEvalHealth {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $result = Test-SkillEvalHealth -Port $Port
    if ($result.Ok) {
      return $result
    }
  } while ((Get-Date) -lt $deadline)
  return $result
}

function Read-ServiceIdentity {
  param(
    [object]$Paths
  )

  if (-not (Test-Path -LiteralPath $Paths.IdentityPath -PathType Leaf)) {
    return $null
  }
  try {
    return Get-Content -Raw -Path $Paths.IdentityPath | ConvertFrom-Json
  } catch {
    Write-Warning "Could not parse service identity file: $($Paths.IdentityPath)"
    return $null
  }
}

function Write-ServiceIdentity {
  param(
    [object]$Paths,
    [int]$ProcessId,
    [int]$Port,
    [string]$BindHost,
    [string]$DataDir
  )

  $identity = [ordered]@{
    pid = $ProcessId
    port = $Port
    host = $BindHost
    dataDir = $DataDir
    repoRoot = $Paths.RepoRoot
    command = $ServiceCommand
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    logPath = $Paths.StdoutPath
    errLogPath = $Paths.StderrPath
  }
  $identity | ConvertTo-Json -Depth 4 | Set-Content -Path $Paths.IdentityPath -Encoding UTF8
  return [pscustomobject]$identity
}

function Remove-ServiceIdentity {
  param(
    [object]$Paths
  )

  if (Test-Path -LiteralPath $Paths.IdentityPath -PathType Leaf) {
    Remove-Item -LiteralPath $Paths.IdentityPath -Force
  }
}

function Rotate-OneLog {
  param(
    [string]$Path,
    [string]$ArchivePath
  )

  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $item = Get-Item -LiteralPath $Path
    if ($item.Length -gt 0) {
      Move-Item -LiteralPath $Path -Destination $ArchivePath -Force
    } else {
      Remove-Item -LiteralPath $Path -Force
    }
  }
}

function Remove-OldArchivedLogs {
  param(
    [object]$Paths
  )

  $logs = @(Get-ChildItem -Path $Paths.ArchiveDir -File -Filter "server-*.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
  $errLogs = @(Get-ChildItem -Path $Paths.ArchiveDir -File -Filter "server-*.err.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)

  foreach ($old in @($logs | Select-Object -Skip $MaxArchivedLogPairs)) {
    Remove-Item -LiteralPath $old.FullName -Force
  }
  foreach ($old in @($errLogs | Select-Object -Skip $MaxArchivedLogPairs)) {
    Remove-Item -LiteralPath $old.FullName -Force
  }
}

function Rotate-ServiceLogs {
  param(
    [object]$Paths
  )

  Initialize-ServiceDirectories -Paths $Paths
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Rotate-OneLog -Path $Paths.StdoutPath -ArchivePath (Join-Path $Paths.ArchiveDir "server-$stamp.log")
  Rotate-OneLog -Path $Paths.StderrPath -ArchivePath (Join-Path $Paths.ArchiveDir "server-$stamp.err.log")
  Remove-OldArchivedLogs -Paths $Paths
}
