# 安装 Better Tasks：DSH 0.2.2-rc.2 / Tasks 0.4.1

> 本页是 rc.2 / 0.4.1 的版本与验包说明。旧 Release 的 Desktop CLI 安装步骤已勘误，实际安装请用[统一 Desktop 安装手册](<install-desktop.md>)。斜杠提交修复需要 0.4.1 主包和匹配的 Conversation fork；其余已匹配的 fork 不必重装。

**rc.2 组合下载入口：** [dsh-v0.2.2-rc.2-tasks-v0.4.1](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.1>)。无需 clone 仓库或编译。

## 1. 先选版本

| Desktop 的 DSH 运行时 | Tasks | 安装来源 |
|---|---|---|
| `0.2.2-rc.2` | `0.4.1` | 本文对应组合 Release，七包全部从这里取 |
| `0.2.1-rc.2` | `0.3.2` | [历史插件及其说明](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.2>)，配对应旧 fork 库 |
| `0.2.0-rc.2` | `0.3.1` | [历史发行版](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.1>) |
| `0.2.2-rc.1` / `0.2.2-rc.3` / 其他 | — | **不要安装本文七包**；需要该运行时单独验证的发行版 |

在 Desktop「关于」确认完整 DSH 运行时版本。本文针对 Desktop 的 `desktop` Profile，不是旧版 Web Profile。下方 PowerShell 只负责下载和验包；安装不使用全局 DSH CLI。

今后的 tag 固定为 `dsh-v<DSH版本>-tasks-v<Tasks版本>`。先按 DSH 版本挑 Release，再在该线选择所需 Tasks 版本；不要把“Latest”当作所有 DSH 的兼容保证。插件 peer 区间只表示依赖门槛，不代表六个 fork 可以跨线通用。

## 2. 下载并校验（此步不修改 DSH）

Release Assets 中应有七个 `.tgz`、`release-manifest.json`、`SHA256SUMS.txt`、`INSTALL.md` 和 `ROLLBACK.md`。GitHub 自动生成的 Source code ZIP/TAR 不是安装包。七包为：

- `veewo-dsh-better-tasks-0.4.1.tgz`
- `deepseek-ai-dsh-client-ui-layout-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-workspace-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-user-questions-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-input-trigger-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-commands-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-conversation-0.2.2-rc.2.tgz`

可浏览器手动下载，也可运行以下 PowerShell（不需要 gh 登录）：

```powershell
$ErrorActionPreference = 'Stop'
$tag = 'dsh-v0.2.2-rc.2-tasks-v0.4.1'
$base = "https://github.com/chanyuenpang/dsh-better-tasks/releases/download/$tag"
$downloadDir = Join-Path (Get-Location) $tag
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$files = @('release-manifest.json', 'SHA256SUMS.txt', 'INSTALL.md', 'ROLLBACK.md',
           'veewo-dsh-better-tasks-0.4.1.tgz')
$slugs = 'layout','workspace','user-questions','input-trigger','commands','conversation'
$files += $slugs | ForEach-Object { "deepseek-ai-dsh-client-ui-$_-0.2.2-rc.2.tgz" }
foreach ($file in $files) {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile (Join-Path $downloadDir $file)
}
# 校验七包，版本组合、文件名和数量不符时停止。
$manifest = Get-Content (Join-Path $downloadDir 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.tag -ne $tag -or $manifest.dshVersion -ne '0.2.2-rc.2' -or
    $manifest.tasksVersion -ne '0.4.1' -or @($manifest.assets).Count -ne 7) {
    throw '发行版本或安装包数量不匹配'
}
$expectedArchives = @($files | Where-Object { $_ -like '*.tgz' } | Sort-Object)
$actualArchives = @($manifest.assets | ForEach-Object { $_.filename } | Sort-Object)
if (@(Compare-Object $expectedArchives $actualArchives).Count -ne 0) { throw '安装包名称不匹配' }
foreach ($asset in $manifest.assets) {
    $path = Join-Path $downloadDir $asset.filename
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $asset.archiveSha256) { throw "SHA-256 不匹配：$($asset.filename)" }
}
'七个安装包 SHA-256 校验通过'
```

校验用于确认下载完整性，清单与安装包应来自同一可信 Release。早期 `better-tasks-forks-0.2.2-rc.2` 的 questions 包不含本次最终输入框回退修复，请勿混用或从 npm 自动替换为官方同名包。

## 3. 按当前 Desktop 手册安装与验收

按[统一安装手册](<install-desktop.md>)备份 Profile、完成目标组合的隔离启动门禁并安装。该组合使用 `nodeLinker: isolated`、`autoInstallPeers: false` 和六个精确 hoist 条目。只换缺失或不匹配的 fork 根依赖，主包走 Desktop 插件管理器；七包匹配后再启用。旧 Release 的 Desktop CLI 命令不适用。

检查侧栏、Session、Workspace 和会话能正常打开，再由用户验收任务卡片、Pin、输入与问答。若提示 `restart-required`，由用户手动完全退出再打开。该 Release 的 `VALIDATION.json` 记录了发行组合的验证范围，不能替代实际候选的启动门禁。

开发版默认强调任务名、项目名为次要信息；已保存的“强调项目名”设置不会被覆盖。若升级后仍显示旧强调方式，在 Tasks 设置中手动选择“强调任务名”。

## 4. 升级、卸载与故障

升级 DSH 前，先找到与新 DSH 完整版本对应的组合 tag；没有对应发布就不要带旧 fork 启用 Better Tasks。更新同一 DSH 下的 Tasks，按目标七包清单核对实际差异，不重装已匹配的包。

卸载与恢复见[当前回滚说明](<rollback.md>)，不执行旧 Release 的 Desktop CLI 步骤。完全卸载时须连同六个 fork 根依赖一起移除，否则它们仍可能遮蔽官方模块。

| 症状 | 优先检查 |
|---|---|
| incompatible with dsh | Desktop/CLI 运行时与 tag 是否完全一致；不要绕过 peer 检查 |
| 侧栏消失或布局服务等待 | 七包是否装齐，是否从同一 Release 取包 |
| 装了插件但界面未变 | 是否完全退出重启；isolated 与六条 publicHoistPattern 是否准确 |
| Cannot find package / cordis | 是否把其他 DSH 核心包错误提升到 Profile 根部 |
| 输入框异常 | 是否用了历史 fork 库的旧 questions 包；请核对本次 SHA-256 |

这六个 fork 是本项目修改的 MIT 兼容包，并非 DeepSeek 官方 npm 发行包。
