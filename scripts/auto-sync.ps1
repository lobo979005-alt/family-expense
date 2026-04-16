# Family Expense - Auto Sync & Restart
# Pulls latest code from current branch, runs npm install if deps changed,
# then (re)starts `node server.js` in the background.

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogFile     = Join-Path $PSScriptRoot 'auto-sync.log'
$PidFile     = Join-Path $PSScriptRoot 'server.pid'
$ServerOut   = Join-Path $PSScriptRoot 'server.out.log'
$ServerErr   = Join-Path $PSScriptRoot 'server.err.log'

function Write-Log($msg) {
    $ts   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "$ts  $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

function Get-SavedPid {
    if (-not (Test-Path $PidFile)) { return $null }
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) { return $null }
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref]$parsed)) { return $parsed }
    return $null
}

function Test-ServerRunning {
    $savedPid = Get-SavedPid
    if (-not $savedPid) { return $false }
    try {
        Get-Process -Id $savedPid -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Stop-Server {
    $savedPid = Get-SavedPid
    if ($savedPid) {
        try {
            Stop-Process -Id $savedPid -Force -ErrorAction Stop
            Write-Log "Stopped server (PID $savedPid)."
        } catch {
            Write-Log "No active process at PID $savedPid."
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Start-Server {
    $proc = Start-Process -FilePath 'node' `
        -ArgumentList 'server.js' `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $ServerOut `
        -RedirectStandardError $ServerErr `
        -WindowStyle Hidden `
        -PassThru
    $proc.Id | Out-File -FilePath $PidFile -Encoding ascii
    Write-Log "Started server (PID $($proc.Id))."
}

Set-Location $ProjectRoot

try {
    Write-Log "=== Auto-sync start ==="

    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    Write-Log "Branch: $branch"

    $before = (git rev-parse HEAD).Trim()
    git fetch origin $branch *>&1 | Out-Null
    $remote = (git rev-parse "origin/$branch").Trim()

    $hasChanges = ($before -ne $remote)
    $serverDown = -not (Test-ServerRunning)

    if ($hasChanges) {
        Write-Log "Changes: $before -> $remote"
        $diffFiles  = git diff --name-only HEAD "origin/$branch"
        $pkgChanged = $diffFiles | Select-String -Pattern '^package(-lock)?\.json$' -Quiet

        git pull origin $branch
        Write-Log "Pulled latest."

        if ($pkgChanged) {
            Write-Log "package.json changed. Running npm install..."
            npm install
            Write-Log "npm install done."
        }
    } else {
        Write-Log "No remote changes."
    }

    if ($hasChanges -or $serverDown) {
        Stop-Server
        Start-Server
    } else {
        Write-Log "Server already running. Nothing to do."
    }

    Write-Log "=== Auto-sync end ==="
} catch {
    Write-Log "ERROR: $_"
    exit 1
}
