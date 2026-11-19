# 安装：DSH 0.2.2-rc.3 / Tasks 0.4.8

组合标识：`dsh-v0.2.2-rc.3-tasks-v0.4.8`。完整七包见[固定版本 Release](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.3-tasks-v0.4.8>)。这是面向 RC 运行时的 Pre-release；npm 主包单独安装不能替代七包组合。以随包 `validation.json` 的目标版本、启动结果与清理结果为准；没有 PASS 记录的组合不得安装。不自动升级或重启真实 Desktop。

## 1. 先确认目标运行时

仅用于 **DSH Desktop `0.2.2-rc.3`**。请在 Desktop「关于」确认完整版本；不要把 rc.3 fork 装进其他运行时，也不要用 npm latest 补包。旧 Release 的 Desktop CLI 安装步骤已勘误：按[当前 Desktop 安装手册](<install-desktop.md>)操作。

rc.2 用户保留 [Tasks 0.4.1 七包](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.1>)，按[rc.2 安装说明](<install.md>)处理。本次 rc.3 适配不覆盖或撤回该版本。先完全退出旧 Desktop，按官方方式升级运行时；升级与本插件安装是两件事。

## 2. 完整候选内容

从固定版本 Release 下载全部独立资产（不是 GitHub 的 Source code ZIP），必须包含以下七包，及 `release-manifest.json`、`SHA256SUMS.txt`、`INSTALL.md`、`ROLLBACK.md`、`validation.json`：

- `veewo-dsh-better-tasks-0.4.8.tgz`
- `deepseek-ai-dsh-client-ui-layout-0.2.2-rc.3.tgz`
- `deepseek-ai-dsh-client-ui-workspace-0.2.2-rc.3.tgz`
- `deepseek-ai-dsh-client-ui-user-questions-0.2.2-rc.3.tgz`
- `deepseek-ai-dsh-client-ui-input-trigger-0.2.2-rc.3.tgz`
- `deepseek-ai-dsh-client-ui-commands-0.2.2-rc.3.tgz`
- `deepseek-ai-dsh-client-ui-conversation-0.2.2-rc.3.tgz`

这些是保留原生包名和许可证的项目 fork，不是 DeepSeek 官方包。旧 rc.3 fork 库早于最近修复，不与本候选混用；源码 ZIP 不是安装包。

```powershell
$ErrorActionPreference = 'Stop'
# 替换为刚解压且已经核对的组合目录；此步不修改 DSH。
$downloadDir = (Resolve-Path './dsh-v0.2.2-rc.3-tasks-v0.4.8').Path
$manifest = Get-Content (Join-Path $downloadDir 'release-manifest.json') -Raw | ConvertFrom-Json
$validation = Get-Content (Join-Path $downloadDir 'validation.json') -Raw | ConvertFrom-Json
if ($manifest.tag -ne 'dsh-v0.2.2-rc.3-tasks-v0.4.8' -or
    $manifest.dshVersion -ne '0.2.2-rc.3' -or $manifest.tasksVersion -ne '0.4.8' -or
    $validation.result -ne 'PASS' -or $validation.dshVersion -ne '0.2.2-rc.3' -or
    !$validation.cleanupComplete -or @($manifest.assets).Count -ne 7) {
    throw '候选版本、数量或启动验证不符；不要安装'
}
$expected = @('veewo-dsh-better-tasks-0.4.8.tgz')
$expected += 'layout','workspace','user-questions','input-trigger','commands','conversation' |
    ForEach-Object { "deepseek-ai-dsh-client-ui-$_-0.2.2-rc.3.tgz" }
if (@(Compare-Object ($expected | Sort-Object) (@($manifest.assets.filename) | Sort-Object)).Count) {
    throw '候选包名不符'
}
foreach ($asset in $manifest.assets) {
    $path = Join-Path $downloadDir $asset.filename
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.archiveSha256) {
        throw "SHA-256 不匹配：$($asset.filename)"
    }
}
'七包与 rc.3 启动证据检查通过'
```

## 3. 按当前 Desktop 手册安装

按[统一安装手册](<install-desktop.md>)核对 Profile、通过隔离启动门禁并备份。保留 `nodeLinker: isolated`、`autoInstallPeers: false` 和六个精确的 hoist 条目。只替换缺失或不匹配的 fork 根依赖；主包走 Desktop 插件管理器。已有六个 fork 全部匹配时，只更新主包。七包核验后再启用新组合；不使用旧 Release 中的批量 Desktop CLI。

## 4. 启动、拖动引用与验收

手动启动同一套 rc.3 Desktop。启动证据仅确认核心 shell/侧栏/Session/Workspace/会话可激活，没有启动错误；**不代替用户功能和外观验收**。

0.4.8 发布已使用的 local.5 执行代码：任务卡与会话行既可合法列表内排序，也可拖入另一主会话的消息区/输入区，向已有草稿插入原生会话引用，不自动发送。修复传输模块漏打包及可选 Remote 子服务访问错误；取消、切会话和真实草稿修改不误提交。合入侧栏期望宽度恢复与标题主要文字色/选中常规字重400。保留初始化、完整顺序持久化、新建置首和子agent状态修复。

拖动非控件区域至另一主会话的消息区即可；引用沿用原生数量、自引用、权限和发送时快照限制，未发送的草稿/附件保留。输入框忙碌、不可见或草稿在异步请求期间变化时拒绝旧结果。引用准备速度仍取决于 DSH 原生候选服务；这不是性能修复版本，见[引用合同](<session-drag-reference.md>)及[上游反馈](<https://github.com/deepseek-ai/deepseek-harness/discussions/5043#discussioncomment-19649223>)。

继续保留 `sidebar.session.action` 原生 HOC 接点。没有可选 action 时新会话按钮不变；DeepSeek 会话导入仍是官方实验性可选 bundle，默认不由 Better Tasks 启用。需要时在插件页启用官方导入插件，其入口通过标准 HOC 出现在新会话行；工作区选择继续用官方 factory。创建会话权限不足时整行不渲染，Better Tasks 不拥有导入解析或 Session 持久化逻辑。

0.4.8 还修复任务卡仅按主 agent 判断 idle 的问题：原生目录中已知子/孙 agent 仍在运行时保持 running；最后一个停止后恢复 idle。标题统一主要文字色（label-primary，浅色近黑/深色近白），普通字重680、选中字重400，两种强调方式和 hover 一致；卡片背景、描边及状态色保留原样。本版已完整合入初始化和顺序持久化优化：恢复已保存的完整任务顺序，不再扫描 Session 目录/历史或计算首工作时间；新增、拖动、移除均持久化顺序，初始化显示“正在恢复任务顺序”，只有真实旧队列导入时才显示合并提示。旧字段保持可读、旧队列保持只读，既有旧数据不删除。详见[完整顺序合同](<task-order-persistence.md>)。Layout、Workspace、Conversation 纳入上述修复，其余三个 fork 复用已验证字节；仅同一 Release 的完整七包构成支持组合。

0.4.8 的新任务置首基于明确创建成功事件（含复用已 Pin 空白），不读取原会话日期或历史；Host 提交后保存完整顺序，刷新或重建后恢复。只有手动调整、新任务前插或移除才改变序列；标题/消息/状态变化不重排。创建期前插显示受保护，旧 GET 不盖回，CAS 冲突重试锚定最新首项。保存失败显式告警，不假装持久化，不改官方会话页。

请自行验收上述新任务置首与顺序保持、状态和选中标题、原生新会话、任务 Pin/排序、独立输入、问答和斜杠提交；遇到异常保留那次 Console 堆栈。回滚见随包 `ROLLBACK.md` 或[回滚说明](<rollback.md>)：先退出、恢复匹配 rc.3 的完整七包与配置；如退回 rc.2，必须把 DSH 运行时和原 rc.2 七包作为整体恢复，不能只降主包。会话、原生 Pin、排序、外观和设置数据不删除。
