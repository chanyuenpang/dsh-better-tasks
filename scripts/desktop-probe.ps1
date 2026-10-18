#requires -Version 7.0
<#
.SYNOPSIS
    Boot a candidate profile with the REAL DeepSeek Harness desktop application and judge it.
.DESCRIPTION
    Why this exists: `dsh --profile X --port N` boots the plain web host through
    `dsh-desktop-host/lib/cli.js`. That path does NOT install the Desktop shell's profile module
    routing, so it happily imports packages the real application later fails on. Every green
    result produced that way is worth less than it looks - the 0.2.1 fork migration was first
    "verified" that way and still crashed the app.

    This harness runs the actual application entry (`app.asar/lib/main.js`):
      * its own DSH_HOME            -> live sessions/storage/profiles are never touched;
      * its own --user-data-dir     -> Electron's single-instance lock does not collide with a
                                       running app, so a second instance can boot side by side;
      * the candidate profile is copied in and its node_modules is junctioned to the source
        profile (no multi-hundred-MB copy);
      * PASS requires: the process is still alive after the settle window, it owns a listening
        port, it printed `dsh web: http://...`, that URL serves a page containing __DSH_BOOT__,
        every installed client plugin appears in the served manifest, and stderr carries no
        fatal startup marker.

.PARAMETER SourceProfile
    Profile directory to boot. An absolute path, or a name under the real profiles directory.

.PARAMETER AppRoot
    Folder containing `DeepSeek Harness.exe`. Auto-detected when omitted.

.PARAMETER SettleSeconds
    How long to wait before judging. Default 25.

.PARAMETER KeepHome
    Keep the isolated home (and the fetched boot page) for post-mortem inspection.

.EXAMPLE
    ./desktop-probe.ps1 -SourceProfile desktop
.EXAMPLE
    ./desktop-probe.ps1 -SourceProfile 'desktop.before-upgrade' -SettleSeconds 40 -KeepHome
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $SourceProfile,
    [string] $AppRoot,
    [int] $SettleSeconds = 25,
    [switch] $KeepHome
)

$ErrorActionPreference = 'Stop'
$realHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }

function Resolve-AppRoot {
    param([string] $Hint)
    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($Hint) { $candidates.Add($Hint) }
    foreach ($pf in @(${env:ProgramFiles}, ${env:ProgramFiles(x86)})) {
        if ($pf) { $candidates.Add((Join-Path $pf 'Deepseek')) }
    }
    foreach ($key in @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        Get-ItemProperty $key -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like '*DeepSeek Harness*' -and $_.InstallLocation } |
            ForEach-Object { $candidates.Add($_.InstallLocation) }
    }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'DeepSeek Harness.exe'))) { return (Resolve-Path $c).Path }
    }
    throw 'Cannot locate the DeepSeek Harness installation. Pass -AppRoot.'
}

if (-not $AppRoot) { $AppRoot = Resolve-AppRoot }
$exe = Join-Path $AppRoot 'DeepSeek Harness.exe'

if (Test-Path $SourceProfile) { $sourceDir = (Resolve-Path $SourceProfile).Path }
else {
    $candidate = Join-Path $realHome "profiles\$SourceProfile"
    if (-not (Test-Path $candidate)) { throw "Profile not found: $SourceProfile (also tried $candidate)" }
    $sourceDir = $candidate
}

$probeHome = Join-Path $env:TEMP ("dsh-probe-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$probeProfile = Join-Path $probeHome 'profiles\desktop'
$probeUserData = Join-Path $probeHome 'userdata'
New-Item -ItemType Directory -Force -Path $probeProfile, $probeUserData | Out-Null

Copy-Item (Join-Path $sourceDir 'package.json') (Join-Path $probeProfile 'package.json') -Force
if (Test-Path (Join-Path $sourceDir 'cordis.patch.yml')) { Copy-Item (Join-Path $sourceDir 'cordis.patch.yml') (Join-Path $probeProfile 'cordis.patch.yml') -Force }
if (Test-Path (Join-Path $sourceDir 'pnpm-workspace.yaml')) { Copy-Item (Join-Path $sourceDir 'pnpm-workspace.yaml') (Join-Path $probeProfile 'pnpm-workspace.yaml') -Force }
else { Set-Content (Join-Path $probeProfile 'pnpm-workspace.yaml') "packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false`n" }

$sourceModules = Join-Path $sourceDir 'node_modules'
$hasModules = Test-Path $sourceModules
if ($hasModules) { New-Item -ItemType Junction -Path (Join-Path $probeProfile 'node_modules') -Target $sourceModules | Out-Null }

$outFile = Join-Path $probeHome 'app.out.txt'
$errFile = Join-Path $probeHome 'app.err.txt'
$env:ELECTRON_RUN_AS_NODE = $null
$env:DSH_HOME = $probeHome

$before = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)

$started = Get-Date
$proc = Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=`"$probeUserData`"") -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile

$verdict = 'FAIL'
$ports = @()
$webUrl = $null
$bootOk = $null
$clientPlugins = @()
$missingClient = @()
try {
    $deadline = (Get-Date).AddSeconds($SettleSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { break }
    }
    $alive = -not $proc.HasExited
    $tree = @($proc.Id)
    foreach ($child in (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue)) { $tree += $child.ProcessId }
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $tree -contains $_.OwningProcess } |
        Select-Object -ExpandProperty LocalPort -Unique)
    $err = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
    $fatal = ($err -match 'startup failed|did not activate|failed to import|cannot be resolved|Error:')
    if ($alive -and $ports.Count -gt 0 -and -not $fatal) { $verdict = 'PASS' }

    if ($verdict -eq 'PASS') {
        $out = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
        $m = [regex]::Match($out, 'dsh web: (http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_\-]+)')
        if ($m.Success) {
            $webUrl = $m.Groups[1].Value
            try {
                $r = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 20
                $bootOk = ($r.Content -match '__DSH_BOOT__')
                try { Set-Content -Path (Join-Path $probeHome 'boot-page.html') -Value $r.Content -NoNewline } catch { }
                if ($hasModules) {
                    foreach ($entry in (Get-ChildItem $sourceModules -Directory -ErrorAction SilentlyContinue)) {
                        $candidates = if ($entry.Name.StartsWith('@')) { Get-ChildItem $entry.FullName -Directory -ErrorAction SilentlyContinue } else { @($entry) }
                        foreach ($c in $candidates) {
                            $pj = Join-Path $c.FullName 'package.json'
                            if (-not (Test-Path $pj)) { continue }
                            try { $pm = Get-Content $pj -Raw | ConvertFrom-Json } catch { continue }
                            if ($pm.dsh.client.platform -eq 'web' -and $pm.name) { $clientPlugins += $pm.name }
                        }
                    }
                    $clientPlugins = @($clientPlugins | Sort-Object -Unique)
                    foreach ($cp in $clientPlugins) { if ($r.Content -notmatch [regex]::Escape($cp)) { $missingClient += $cp } }
                }
            } catch { $bootOk = "request failed: $($_.Exception.Message)" }
        }
        if ($bootOk -eq $false -or $missingClient.Count -gt 0) { $verdict = 'FAIL' }
    }
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    if ($ports) {
        foreach ($owner in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique)) {
            if ($before -notcontains $owner) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
        }
    }
}

Write-Host ''
Write-Host "desktop probe: $verdict" -ForegroundColor $(if ($verdict -eq 'PASS') { 'Green' } else { 'Red' })
Write-Host "  profile       : $sourceDir"
Write-Host "  node_modules  : $(if ($hasModules) { 'junctioned' } else { 'ABSENT (bundles cannot resolve)' })"
Write-Host "  seconds       : $([int]((Get-Date) - $started).TotalSeconds)"
Write-Host "  listen ports  : $(if ($ports) { $ports -join ', ' } else { 'none' })"
Write-Host "  web url       : $(if ($webUrl) { $webUrl -replace 'token=[^&]+', 'token=***' } else { 'not printed' })"
Write-Host "  boot manifest : $(if ($bootOk -eq $true) { 'served (__DSH_BOOT__ present)' } elseif ($bootOk -eq $false) { 'MISSING __DSH_BOOT__' } else { $bootOk })"
if ($clientPlugins.Count -gt 0) {
    Write-Host "  client plugins: $($clientPlugins.Count) installed, $($clientPlugins.Count - $missingClient.Count) in boot manifest"
    foreach ($cp in $missingClient) { Write-Host "      x $cp not served" -ForegroundColor Red }
}
$errText = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
if ($errText) {
    Write-Host '  stderr:' -ForegroundColor Yellow
    foreach ($line in ($errText -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 40)) { Write-Host "    $line" }
}
$outText = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
if ($outText) {
    Write-Host '  stdout (first 20 lines):' -ForegroundColor DarkGray
    foreach ($line in ($outText -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 20)) { Write-Host "    $line" -ForegroundColor DarkGray }
}
$startupLogs = Get-ChildItem (Join-Path $probeHome 'logs') -Filter 'startup-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($startupLogs) {
    Write-Host '  startup diagnostics:' -ForegroundColor Yellow
    foreach ($line in (Get-Content $startupLogs.FullName -ErrorAction SilentlyContinue | Select-Object -First 60)) { Write-Host "    $line" -ForegroundColor Yellow }
}

if (-not $KeepHome) {
    $mods = Join-Path $probeProfile 'node_modules'
    if (Test-Path $mods) { $item = Get-Item $mods -Force; if ($item.LinkType -in @('Junction', 'SymbolicLink')) { cmd /c rmdir "`"$mods`"" | Out-Null } }
    Remove-Item $probeHome -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "  probe home kept: $probeHome" -ForegroundColor DarkYellow
}
if ($verdict -ne 'PASS') { exit 1 }
exit 0
