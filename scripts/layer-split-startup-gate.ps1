# Sandbox cold-start gate for the 0.2.2-rc.1 layer-split candidate.
#
# Boots the REAL desktop application against an isolated DSH_HOME and profile, then
# judges only startup safety: the process stays alive, it owns a listening port, the
# served page carries __DSH_BOOT__, every installed client plugin appears in the boot
# manifest, and stderr carries no fatal marker.
#
# Why the real application and not `dsh --profile X --port N`: the CLI path does not
# install the Desktop shell's profile module routing, so it can pass while the app
# fails to import the same package (the 0.2.1 migration proved that the hard way).
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Sandbox,
    [string] $AppRoot = 'H:\Program Files\Deepseek',
    [int] $SettleSeconds = 25
)

$ErrorActionPreference = 'Stop'
$base = (Resolve-Path $Sandbox).Path
$baseline = Get-Content (Join-Path $base 'baseline.json') -Raw | ConvertFrom-Json

if (Get-NetTCPConnection -State Listen -LocalPort 39422, 9228 -ErrorAction SilentlyContinue) {
    throw 'Sandbox ports are occupied; a cold-start gate must start from nothing.'
}

# Installed bytes must be the candidate bytes, not a link to a live profile.
foreach ($candidate in $baseline.candidates) {
    if ($baseline.forks -notcontains $candidate.slug) { continue }
    $client = Join-Path $baseline.profile "node_modules\$($candidate.name)\lib\client.js"
    if (-not (Test-Path -LiteralPath $client)) { throw "candidate not installed: $($candidate.name)" }
    $hash = (Get-FileHash -LiteralPath $client -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $candidate.clientSha256) { throw "installed bytes differ from candidate: $($candidate.name)" }
}

$userData = Join-Path $base 'electron-gate'
if (Test-Path $userData) { throw 'Refusing to reuse an Electron cache for a cold-start gate.' }

$env:DSH_HOME = $baseline.home
$env:DSH_PROFILE = 'desktop'
$env:DSH_PROFILE_DIR = $baseline.profile
foreach ($key in @('DSH_SESSION_ID', 'DSH_WEB_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS')) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
}

$exe = Join-Path $AppRoot 'DeepSeek Harness.exe'
$outFile = Join-Path $base 'gate.out.log'
$errFile = Join-Path $base 'gate.err.log'
$before = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)

$proc = Start-Process -FilePath $exe -ArgumentList @(
    "--user-data-dir=$userData",
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9228'
) -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile

@{ pid = $proc.Id; startedAt = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content (Join-Path $base 'gate.process.json')

$deadline = (Get-Date).AddSeconds($SettleSeconds)
$webUrl = $null
$port = $null
do {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    $ports = @(Get-NetTCPConnection -State Listen -OwningProcess $proc.Id -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty LocalPort -Unique)
    if ($ports.Count -gt 0) { $port = $ports[0] }
    $log = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
    if ($log -match 'dsh web: (http://\S+)') { $webUrl = $Matches[1]; break }
} while ((Get-Date) -lt $deadline)

$result = [ordered]@{
    result       = 'FAIL'
    pid          = $proc.Id
    alive        = -not $proc.HasExited
    port         = $port
    webUrl       = $webUrl
    bootMarker   = $false
    manifestOk   = $false
    missing      = @()
    fatalStderr  = @()
    settleSeconds = $SettleSeconds
}

if ($webUrl -ne $null) {
    try {
        $page = Invoke-WebRequest -Uri $webUrl -TimeoutSec 20 -UseBasicParsing
        $html = $page.Content
        $result.bootMarker = $html.Contains('__DSH_BOOT__')
        $missing = @()
        foreach ($candidate in $baseline.candidates) {
            if ($baseline.forks -notcontains $candidate.slug) { continue }
            if (-not $html.Contains($candidate.name)) { $missing += $candidate.name }
        }
        $result.missing = $missing
        $result.manifestOk = ($missing.Count -eq 0)
    } catch {
        $result.fatalStderr += "page fetch failed: $($_.Exception.Message)"
    }
}

if (Test-Path $errFile) {
    $fatal = @(Get-Content $errFile | Where-Object {
            $_ -match 'startup failed|did not activate|failed to import|Cannot find package|ERR_MODULE|Unhandled'
        })
    $result.fatalStderr = @($result.fatalStderr) + $fatal
}

# The app must never linger: this is a startup probe, not a session.
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$remaining = @(Get-NetTCPConnection -State Listen -LocalPort 39422, 9228 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 })
$result.cleanupPidsRemaining = $remaining

if ($result.alive -and $result.bootMarker -and $result.manifestOk -and $result.fatalStderr.Count -eq 0) {
    $result.result = 'PASS'
}

$result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $base 'gate.result.json')
$result | ConvertTo-Json -Depth 5
if ($result.result -ne 'PASS') { exit 1 }
