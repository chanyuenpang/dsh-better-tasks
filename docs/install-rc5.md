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

## 真实升级是另一步

1. 先安排停机，再备份真实 Profile 的配置、依赖锁、现有匹配的 rc.3 七包及恢复所需的数据备份；保留其他插件。不要将真实 Profile 或数据指给沙盒。评估现有其他本地插件的 rc.5 兼容性。
2. 只用官方发行的 Windows Desktop，确认运行时和 CLI 都是 `0.2.2-rc.5`。不要先让 rc.3 fork 在 rc.5 上运行，也不要把 rc.5 fork 装到运行中的 rc.3 上。
3. 真实安装时保持 Desktop 停止。在 Profile 的 `pnpm-workspace.yaml` 保留其他配置；使用 `nodeLinker: isolated`、`autoInstallPeers: false`，仅将六个 fork 的完整 `@deepseek-ai/dsh-client-ui-*` 包名加入 `publicHoistPattern`，不要 hoist 整个 scope。用目标 CLI 一次安装所有七个本地归档：`dsh plugin --profile desktop add @specs`，其中 `$specs = @($m.assets | ForEach-Object { (Resolve-Path -LiteralPath $_.filename).Path })`。不要手改或重复 native disable 行。
4. 安装与重新打开真实 Desktop 各自确认。启动门禁只验证核心 shell，不替代真实 Profile 的兼容性检查及用户功能验收。失败先按随包 `ROLLBACK.md` 恢复版本匹配的组合。
