param(
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][string]$ReportPath,
  [Parameter(Mandatory=$true)][string]$StartupEvidence
)
$ErrorActionPreference='Stop'
# Run ONLY after the exact candidate cold-starts with the same approved argument.
$startup=Get-Content -LiteralPath $StartupEvidence -Raw | ConvertFrom-Json
if($startup.result -ne 'PASS' -or $startup.startupOnly -ne $true){throw 'Startup-only gate evidence is required'}
$processEvidence=Join-Path (Split-Path -Parent $StartupEvidence) 'enabled.process.json'
$started=Get-Content -LiteralPath $processEvidence -Raw | ConvertFrom-Json
if($started.allowMotion -ne $true -or $started.arguments -notmatch '(^|\s)--force-prefers-no-reduced-motion(\s|$)'){throw 'Gate did not use the approved launch preference'}
$expectedTarget='H:\Program Files\Deepseek\DeepSeek Harness.exe'
$flag='--force-prefers-no-reduced-motion'
$paths=@(
 'C:\Users\chany\Desktop\DeepSeek Harness.lnk',
 'C:\Users\chany\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk',
 'C:\Users\chany\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\DeepSeek Harness.lnk'
)
if (Test-Path -LiteralPath $BackupDirectory) { throw 'Refusing to overwrite launcher backup' }
if (Test-Path -LiteralPath $ReportPath) { throw 'Refusing to overwrite launcher evidence' }
$shell=New-Object -ComObject WScript.Shell
$records=@()
foreach ($path in $paths) {
 if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Launcher is missing: $path" }
 $link=$shell.CreateShortcut($path)
 if ($link.TargetPath -ne $expectedTarget) { throw "Unexpected launcher target: $path" }
 if ($link.Arguments -match '(^|\s)--force-prefers-reduced-motion(=|\s|$)') { throw "Conflicting explicit reduced-motion argument: $path" }
 $before=[ordered]@{target=$link.TargetPath;arguments=$link.Arguments;workingDirectory=$link.WorkingDirectory;icon=$link.IconLocation;description=$link.Description;hotkey=$link.Hotkey;windowStyle=$link.WindowStyle}
 $newArgs=if($link.Arguments -match '(^|\s)--force-prefers-no-reduced-motion(\s|$)'){$link.Arguments}else{($link.Arguments+' '+$flag).Trim()}
 $records+=@{path=$path;before=$before;newArguments=$newArgs;beforeSha256=(Get-FileHash -LiteralPath $path).Hash;changed=$false}
}
New-Item -ItemType Directory -Path $BackupDirectory | Out-Null
for($i=0;$i -lt $records.Count;$i++) {
 $records[$i].backup=Join-Path $BackupDirectory ("launcher-$i.lnk")
 Copy-Item -LiteralPath $records[$i].path -Destination $records[$i].backup
}
$records | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $BackupDirectory 'before.json')
try {
 foreach($record in $records) {
  if((Get-FileHash -LiteralPath $record.path).Hash -ne $record.beforeSha256){throw 'Launcher changed concurrently; no overwrite permitted'}
  $link=$shell.CreateShortcut($record.path)
  if($link.Arguments -ne $record.newArguments){$link.Arguments=$record.newArguments;$link.Save();$record.changed=$true}
  $record.afterSha256=(Get-FileHash -LiteralPath $record.path).Hash
  $check=$shell.CreateShortcut($record.path)
  if($check.Arguments -ne $record.newArguments -or $check.TargetPath -ne $record.before.target -or $check.WorkingDirectory -ne $record.before.workingDirectory -or $check.IconLocation -ne $record.before.icon -or $check.Description -ne $record.before.description -or $check.Hotkey -ne $record.before.hotkey -or $check.WindowStyle -ne $record.before.windowStyle){throw 'Launcher metadata verification failed'}
 }
} catch {
 foreach($record in $records){
  if($record.changed -and $paths -contains $record.path -and (Get-FileHash -LiteralPath $record.path).Hash -eq $record.afterSha256){Copy-Item -LiteralPath $record.backup -Destination $record.path -Force}
 }
 throw
}
$result=@{result='PASS';checkedAt=(Get-Date).ToUniversalTime().ToString('o');argument=$flag;shortcuts=@($records|ForEach-Object{@{path=$_.path;changed=$_.changed;beforeSha256=$_.beforeSha256;afterSha256=$_.afterSha256}});otherShortcutPropertiesPreserved=$true;systemPreferencesChanged=$false;realRestartPerformed=$false}
$result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $ReportPath
$result | ConvertTo-Json -Depth 6
