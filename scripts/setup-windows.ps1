# Family Expense - One-shot Windows setup
# Runs from the repo root. Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
#
# Sets execution policy, smoke-tests auto-sync, registers a Task Scheduler job.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SyncScript  = Join-Path $PSScriptRoot 'auto-sync.ps1'
$TaskName    = 'FamilyExpenseAutoSync'
$IntervalMin = 5

Write-Host "Project root: $ProjectRoot" -ForegroundColor Cyan

# 1. Prerequisite check
foreach ($cmd in @('node','npm','git')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing prerequisite: $cmd. Install it first."
    }
}
Write-Host "[OK] node / npm / git found." -ForegroundColor Green

# 2. Execution policy (CurrentUser scope)
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq 'Restricted' -or $policy -eq 'Undefined') {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
    Write-Host "[OK] Set ExecutionPolicy to RemoteSigned (CurrentUser)." -ForegroundColor Green
} else {
    Write-Host "[OK] ExecutionPolicy already '$policy'." -ForegroundColor Green
}

# 3. Smoke test: run auto-sync once
Write-Host "`nRunning auto-sync smoke test..." -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File $SyncScript
if ($LASTEXITCODE -ne 0) {
    throw "auto-sync.ps1 failed. Check scripts\auto-sync.log."
}
Write-Host "[OK] Smoke test passed." -ForegroundColor Green

# 4. Register scheduled task (recreates if exists)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'." -ForegroundColor Yellow
}

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$SyncScript`""
$trigger  = New-ScheduledTaskTrigger -Once (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMin)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest -Force | Out-Null

Write-Host "[OK] Scheduled task '$TaskName' registered (every $IntervalMin min)." -ForegroundColor Green
Write-Host "`nLogs: scripts\auto-sync.log / server.out.log / server.err.log"
Write-Host "Done." -ForegroundColor Cyan
