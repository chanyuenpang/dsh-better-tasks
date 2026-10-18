#requires -Version 7.0
<#
.SYNOPSIS
    Pack the client UI forks for one dsh version into installable tarballs.
.DESCRIPTION
    Each fork ships the OFFICIAL published bytes of `@deepseek-ai/dsh-client-ui-<slug>@<Version>`
    with `lib/client.js` replaced by `forks-<Version>/<slug>/lib/client.js`. Keeping the official
    bytes for everything else (package.json, locale, types) is what makes the fork a drop-in
    replacement for the app-owned module.

    Requires, per slug:
      third_party/<slug>/<Version>/package/   official extraction (must contain lib/client.js)
      forks-<Version>/<slug>/lib/client.js    built artifact

    Writes `releases/<Version>-forks/`: one tarball per fork plus `candidates.json`
    (archiveSha256 + clientSha256), which the better-tasks repack and the live verification
    compare against.
.PARAMETER Version
    The dsh version the forks were built for, e.g. 0.2.1-rc.2.
.EXAMPLE
    ./scripts/pack-forks.ps1 -Version 0.2.2-rc.1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Version
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$outDir = Join-Path $repo "releases\$Version-forks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$slugs = @('ui-layout', 'ui-workspace', 'ui-user-questions', 'ui-input-trigger', 'ui-commands', 'ui-conversation')
$rows = @()
foreach ($slug in $slugs) {
    $official = Join-Path $repo "third_party\$slug\$Version\package"
    if (-not (Test-Path (Join-Path $official 'lib\client.js'))) {
        throw "missing official bytes for $slug at $official - npm pack the package and extract it to package/ first"
    }
    $fork = Join-Path $repo "forks-$Version\$slug\lib\client.js"
    if (-not (Test-Path $fork)) { throw "missing fork artifact for $slug at $fork - run build-forks-from-source.mjs --build first" }

    $stage = Join-Path $outDir "$slug\package"
    Remove-Item (Join-Path $outDir $slug) -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item (Join-Path $official '*') $stage -Recurse -Force
    Copy-Item $fork (Join-Path $stage 'lib\client.js') -Force

    Push-Location $outDir
    $packed = npm pack (Join-Path $outDir $slug\package) --silent 2>&1 | Select-Object -Last 1
    Pop-Location
    $tgz = Join-Path $outDir $packed.Trim()
    if (-not (Test-Path $tgz)) { throw "npm pack failed for $slug ($packed)" }

    $rows += [pscustomobject]@{
        slug          = $slug
        name          = "@deepseek-ai/dsh-client-$slug"
        version       = $Version
        archive       = $tgz
        archiveSha256 = (Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower()
        clientSha256  = (Get-FileHash (Join-Path $stage 'lib\client.js') -Algorithm SHA256).Hash.ToLower()
        size          = (Get-Item $tgz).Length
    }
    Write-Host ("{0,-20} {1,-52} {2} bytes" -f $slug, $packed.Trim(), (Get-Item $tgz).Length)
}
$rows | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outDir 'candidates.json')
Write-Host ''
Write-Host "packed $($rows.Count) forks into $outDir"
