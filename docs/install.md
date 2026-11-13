# 安装 Better Tasks：DSH 0.2.2-rc.2 / Tasks 0.4.0

**本次唯一完整安装入口：** [dsh-v0.2.2-rc.2-tasks-v0.4.0](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.0>)。无需 clone 仓库或编译。

## 1. 先选版本

| Desktop 的 DSH 运行时 | Tasks | 安装来源 |
|---|---|---|
| `0.2.2-rc.2` | `0.4.0` | 本文对应组合 Release，七包全部从这里取 |
| `0.2.1-rc.2` | `0.3.2` | [历史插件及其说明](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.2>)，配对应旧 fork 库 |
| `0.2.0-rc.2` | `0.3.1` | [历史发行版](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.1>) |
| `0.2.2-rc.1` / `0.2.2-rc.3` / 其他 | — | **不要安装本文七包**；需要该运行时单独验证的发行版 |

在 Desktop「关于」确认完整 DSH 运行时版本；若使用 CLI，再核对 `dsh --version`，确保不是另一套安装。本文针对 Desktop 的 `desktop` Profile，不是旧版 Web Profile。Windows 命令在能执行 `dsh plugin` 的 PowerShell 终端运行；若命令不存在，请先配置与当前 Desktop 同版本的 DSH CLI，勿随意装 npm latest。

今后的 tag 固定为 `dsh-v<DSH版本>-tasks-v<Tasks版本>`。先按 DSH 版本挑 Release，再在该线选择所需 Tasks 版本；不要把“Latest”当作所有 DSH 的兼容保证。插件 peer 区间只表示依赖门槛，不代表六个 fork 可以跨线通用。

## 2. 下载并校验（此步不修改 DSH）

Release Assets 中应有七个 `.tgz`、`release-manifest.json`、`SHA256SUMS.txt`、`INSTALL.md` 和 `ROLLBACK.md`。GitHub 自动生成的 Source code ZIP/TAR 不是安装包。七包为：

- `veewo-dsh-better-tasks-0.4.0.tgz`
- `deepseek-ai-dsh-client-ui-layout-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-workspace-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-user-questions-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-input-trigger-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-commands-0.2.2-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-conversation-0.2.2-rc.2.tgz`

可浏览器手动下载，也可运行以下 PowerShell（不需要 gh 登录）：

```powershell
$ErrorActionPreference = 'Stop'
$tag = 'dsh-v0.2.2-rc.2-tasks-v0.4.0'
$base = "https://github.com/chanyuenpang/dsh-better-tasks/releases/download/$tag"
$downloadDir = Join-Path (Get-Location) $tag
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$files = @('release-manifest.json', 'SHA256SUMS.txt', 'INSTALL.md', 'ROLLBACK.md',
           'veewo-dsh-better-tasks-0.4.0.tgz')
$slugs = 'layout','workspace','user-questions','input-trigger','commands','conversation'
$files += $slugs | ForEach-Object { "deepseek-ai-dsh-client-ui-$_-0.2.2-rc.2.tgz" }
foreach ($file in $files) {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile (Join-Path $downloadDir $file)
}
# 校验七包，版本组合、文件名和数量不符时停止。
$manifest = Get-Content (Join-Path $downloadDir 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.tag -ne $tag -or $manifest.dshVersion -ne '0.2.2-rc.2' -or
    $manifest.tasksVersion -ne '0.4.0' -or @($manifest.assets).Count -ne 7) {
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

## 3. 完全退出并备份 Profile

完成正在运行的任务，手动完全退出 Desktop（包括托盘），确认旧进程已退出。安装和升级都在退出后进行，避免热替换 UI。

默认 Profile 是 `~/.dsh/profiles/desktop`；自定义 `DSH_HOME` 时使用实际路径，不要备份/修改错目录。至少备份 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.yml` 和 `cordis.patch.yml`（存在的文件），并保留旧的完整安装包。备份只存自己机器，不要上传 GitHub。

```powershell
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome 'profiles/desktop'
if (!(Test-Path -LiteralPath $profileDir -PathType Container)) { throw "请确认实际 Profile：$profileDir" }
$backupDir = "$profileDir.before-better-tasks-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($file in 'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml','cordis.patch.yml') {
    $path = Join-Path $profileDir $file
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $backupDir }
}
"备份位置：$backupDir"
```

## 4. 配置 Profile 模块解析（必需）

编辑自己 Profile 的 `pnpm-workspace.yaml`，**合并**以下配置；保留原有其他包、工作区与插件设置，不要盲目覆盖整个文件：

```yaml
packages:
  - .
nodeLinker: isolated
autoInstallPeers: false
publicHoistPattern:
  - '@deepseek-ai/dsh-client-ui-layout'
  - '@deepseek-ai/dsh-client-ui-workspace'
  - '@deepseek-ai/dsh-client-ui-user-questions'
  - '@deepseek-ai/dsh-client-ui-input-trigger'
  - '@deepseek-ai/dsh-client-ui-commands'
  - '@deepseek-ai/dsh-client-ui-conversation'
```

只有这六个原生包名在 Profile 根部解析到 fork，Desktop 才能加载它们。`nodeLinker: hoisted` 可能丢失插件本身的客户端入口；也不要增加会把整个 `@deepseek-ai/*` 核心依赖提升到根部的通配规则。若与现有插件策略冲突，先停下检查，不要用 `--force` 或关闭 pnpm 安全检查。

**仅在此前使用其他 linker 时**：备份后确认 `$profileDir` 为刚才核对的绝对路径，只清理该目录内可重建的 `node_modules`（必要时连同旧 `pnpm-lock.yaml`），再执行下一步。不要删除整个 Profile 或 DSH_HOME；其余用户数据不应动。

## 5. 一起安装七包

沿用上面下载与校验后的 `$downloadDir` 和 `$manifest`：

```powershell
$specs = @($manifest.assets | ForEach-Object { Join-Path $downloadDir $_.filename })
dsh plugin --profile desktop add @specs
if ($LASTEXITCODE -ne 0) { throw '安装失败；不要启动 Desktop，先按回滚说明恢复' }
```

也可以在插件管理器支持本地 tarball 的环境中选择这七包，但仍须满足前面的 Profile 配置和完整退出条件。不要只安装插件本体：插件的 patch 会接管侧栏，缺 fork 会造成半安装。不要手工把禁用行粘到用户 patch 中；由插件 bundle 管理可移除的 patch 层。

## 6. 启动与验收

手动启动同一套 Desktop，检查侧栏、Session、Workspace 和会话界面能正常打开，主输入框存在；再由使用者验收任务卡片、Pin、输入、问答等功能。若设置提示 restart required，应完全退出再打开，而不是只刷新页面。

有源码检出时，可选运行 `./scripts/desktop-probe.ps1 -SourceProfile desktop`，期望 `desktop probe: PASS`，安装的客户端插件均出现在 boot manifest。纯 CLI Host 可启动、或仅 manifest 存在，不等于实际 Desktop UI 验收通过。当前发布验证范围见同一 Release 的 `validation.json`。

## 7. 升级、卸载与故障

升级 DSH 前，先找到与新 DSH 完整版本对应的组合 tag；没有对应发布就先不要带旧 fork 升级。更新同一 DSH 下的 Tasks，也应重新取齐新 Release 七包和校验清单。

卸载与恢复步骤见同一 Release 的 `ROLLBACK.md` 或[固定版本回滚说明](<https://github.com/chanyuenpang/dsh-better-tasks/blob/dsh-v0.2.2-rc.2-tasks-v0.4.0/docs/rollback.md>)。卸载时须连同六个 fork 依赖一起移除，否则它们还会遮蔽官方模块。

| 症状 | 优先检查 |
|---|---|
| incompatible with dsh | Desktop/CLI 运行时与 tag 是否完全一致；不要绕过 peer 检查 |
| 侧栏消失或布局服务等待 | 七包是否装齐，是否从同一 Release 取包 |
| 装了插件但界面未变 | 是否完全退出重启；isolated 与六条 publicHoistPattern 是否准确 |
| Cannot find package / cordis | 是否把其他 DSH 核心包错误提升到 Profile 根部 |
| 输入框异常 | 是否用了历史 fork 库的旧 questions 包；请核对本次 SHA-256 |

这六个 fork 是本项目修改的 MIT 兼容包，并非 DeepSeek 官方 npm 发行包。
