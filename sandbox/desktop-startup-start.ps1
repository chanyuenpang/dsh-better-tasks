param(
  [string]$Sandbox = (Join-Path $PSScriptRoot '.desktop-startup-027'),
  [ValidateSet('enabled','disabled')][string]$Mode = 'enabled',
  [ValidatePattern('^[a-z0-9-]+$')][string]$RunId = $Mode,
  [switch]$AllowMotion
)
$ErrorActionPreference = 'Stop'
$base = (Resolve-Path $Sandbox).Path
$baseline = Get-Content (Join-Path $base 'baseline.json') -Raw | ConvertFrom-Json
if (Get-NetTCPConnection -State Listen -LocalPort 39422,9228 -ErrorAction SilentlyContinue) { throw 'Sandbox ports occupied' }
# Verify the four files produced by package installation, not links to live forks.
foreach ($candidate in $baseline.candidates) {
  $client = Join-Path $baseline.profile "node_modules\$($candidate.name)\lib\client.js"
  if (-not (Test-Path -LiteralPath $client)) {
    $client = Join-Path $baseline.profile "node_modules\@veewo\dsh-better-tasks\node_modules\$($candidate.name)\lib\client.js"
  }
  if ((Get-FileHash $client).Hash.ToLowerInvariant() -ne $candidate.clientSha256) { throw "Installed candidate mismatch: $($candidate.name)" }
}
$env:DSH_HOME = $baseline.home
$env:DSH_PROFILE = 'desktop'
$env:DSH_PROFILE_DIR = $baseline.profile
foreach ($key in @('DSH_SESSION_ID','DSH_WEB_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS')) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
$exe = 'H:\Program Files\Deepseek\DeepSeek Harness.exe'
# Mode gets a fresh Electron user-data directory and logs, even though the profile
# deliberately keeps the installed fork packages in the disabled-provider test.
$userData = Join-Path $base "electron-$RunId"
if (Test-Path $userData) { throw 'Refusing to reuse an Electron cache for cold-start gate' }
$launchArgs = "--user-data-dir=$userData --remote-debugging-address=127.0.0.1 --remote-debugging-port=9228"
if ($AllowMotion) { $launchArgs += ' --force-prefers-no-reduced-motion' }
$p = Start-Process -FilePath $exe -ArgumentList $launchArgs -PassThru -RedirectStandardOutput "$base\$RunId.out.log" -RedirectStandardError "$base\$RunId.err.log"
@{pid=$p.Id;mode=$Mode;home=$baseline.home;profile=$baseline.profile;port=39422;cdp=9228;executable=$exe;allowMotion=[bool]$AllowMotion;arguments=$launchArgs} | ConvertTo-Json | Set-Content "$base\$RunId.process.json"
Write-Output "Isolated Desktop mode=$Mode pid=$($p.Id); host39422/cdp9228"
$p.WaitForExit()
exit $p.ExitCode
