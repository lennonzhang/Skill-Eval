param(
  [int]$Port = 4173,
  [string]$BindHost = "127.0.0.1",
  [string]$DataDir = "data",
  [string]$LogLevel = "info"
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "service-stop.ps1") -Port $Port
& (Join-Path $PSScriptRoot "service-start.ps1") -Port $Port -BindHost $BindHost -DataDir $DataDir -LogLevel $LogLevel
