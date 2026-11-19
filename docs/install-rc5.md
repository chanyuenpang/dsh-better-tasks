# 安装：DSH 0.2.2-rc.5 / Better Tasks 0.4.9

从 [固定 GitHub Pre-release](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.5-tasks-v0.4.9>) 下载七个独立 `.tgz` 和校验/验证文件。仅用于 **Windows x64 Desktop 0.2.2-rc.5**。Better Tasks 功能延续 rc.3 / 0.4.8。不可用 rc.3 fork 或 npm `latest` 补包；源码 ZIP 不是安装包。

## 先验包，不改 Profile

在本目录执行以下 PowerShell 检查。若组合、哈希或启动记录不符，不要安装。

```powershell
$ErrorActionPreference = 'Stop'
$m = Get-Content -LiteralPath ./release-manifest.json -Raw | ConvertFrom-Json
$v = Get-Content -LiteralPath ./validation.json -Raw | ConvertFrom-Json
$id = 'dsh-v0.2.2-rc.5-tasks-v0.4.9'
if ($m.id -ne $id -or $v.id -ne $id -or $m.dshVersion -ne '0.2.2-rc.5' -or
    $v.dshVersion -ne '0.2.2-rc.5' -or $v.result -ne 'PASS' -or !$v.cleanupComplete -or
    @($m.assets).Count -ne 7 -or @($v.servedClientHashes).Count -ne 7) { throw '不符合候选安装条件' }
$names = @('veewo-dsh-better-tasks-0.4.9.tgz')
$names += 'layout','workspace','user-questions','input-trigger','commands','conversation' |
    ForEach-Object { "deepseek-ai-dsh-client-ui-$_-0.2.2-rc.5.tgz" }
if (@(Compare-Object ($names | Sort-Object) (@($m.assets.filename) | Sort-Object)).Count) { throw '文件名不匹配' }
foreach ($a in $m.assets) {
    if ((Get-FileHash -LiteralPath $a.filename).Hash.ToLowerInvariant() -ne $a.archiveSha256) { throw "哈希不匹配：$($a.filename)" }
    $verified = @($v.servedClientHashes | Where-Object { $_.name -eq $a.name -and $_.clientSha256 -eq $a.clientSha256 })
    if ($verified.Count -ne 1) { throw "启动证据与包不匹配：$($a.filename)" }
}
```

## 安装与启用（旧 Release 安装说明勘误）

固定 tag 的 `INSTALL.md` 步骤 3 中的批量 Desktop CLI **不可用**。`desktop` Profile 由 Electron 管理，六个 fork 也不是可单独安装的 bundle。请按 [Windows Desktop 安装手册](<install-desktop.md>)操作。该组合使用 `nodeLinker: isolated` 及六个精确 hoist 条目，详见手册。

- 已运行 rc.5 但仍有 rc.3 fork：不要启用旧 Better Tasks；先验证候选并备份，再经授权替换不匹配的 fork。主包走插件管理器，七包实装哈希核对后才启用。
- 已运行 rc.5 且目标六个 fork 全部匹配：只需走插件管理器更新主包，不必重装六个 fork。
- 尚未升级到 rc.5：先准备与目标版本匹配的组合和回滚方案，不把 rc.5 包装进 rc.3。Desktop 自身的升级、插件安装和真实重启分别处理。

旧 Release 的包、哈希和验证记录仍有效。本机功能验收由用户完成；故障按[当前回滚说明](<rollback.md>)处理。
