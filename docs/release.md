# Better Tasks：按 DSH 版本发布

## 当前公开组合与 tag 规则

- DSH Desktop：**0.2.2-rc.5**；Better Tasks：**0.4.9**。
- Git tag / GitHub Release：**`dsh-v0.2.2-rc.5-tasks-v0.4.9`**（Pre-release，GitHub 提供完整七包）。npm 的 `dsh-0.2.2-rc.5` 指向主包 `0.4.9`，`latest` 仍为 `0.4.8`；npm 不是七包安装入口。
- 操作入口：[Windows Desktop 安装手册](<install-desktop.md>)；[rc.5](<install-rc5.md>)、[rc.3](<install-rc3.md>)、[rc.2](<install.md>)页面用于选包、验包与旧 Release 勘误。历史资产保持不变。

今后统一使用 `dsh-v<DSH版本>-tasks-v<Tasks版本>`。DSH 版本写完整，保留 rc 后缀；Tasks 版本仍由插件自己的 manifest 管理。同一 Tasks 源码可适配多条 DSH 线，但每条线都要有独立验证的组合 Release。已发布的 tag 与资产 URL 不移动、不覆盖；内容变化应升 Tasks 版本并创建新组合 tag。面向 RC 运行时的本次组合标记为 GitHub Pre-release，不依赖全局 Latest 作为安装入口。

## 唯一开发分支

- `main` 是唯一日常开发、修复和适配入口；不新建或继续维护 feature/release/按 DSH 版本划分的长期分支。旧分支只作历史引用，不再接收开发提交。
- 2026-11-14 将 `release/0.3.0` 的最新已提交代码 `5c34bef`（Tasks 0.4.1）快进合入 `main`，保留全部 19 个提交的历史；GitHub 默认分支仍为 `main`。
- 支持标记只用 `main` 上的 annotated 组合 tag；源码可以包含尚未发布的新线适配。某条线只有在目标运行时精确组合门禁和完整七包 Release 就绪后，才能宣称支持。
- 从历史 tag 排查问题用 detached checkout 或只读对比；修复最终仍提交到 `main`，不维护旧版本开发分支，不移动历史 tag。
- Tasks 0.4.2 是本轮 rc.3 适配候选，见[适配记录](<dsh-0.2.2-rc.3-support.md>)和[候选安装说明](<install-rc3.md>)。公开 rc.2 / Tasks 0.4.1 入口保留；候选的七包与精确 rc.3 启动证据单独交付，不将源码提交或 tag 当成 GitHub/npm 已发布。

## 本次组合与历史内容

0.4.9 / rc.5：保留 0.4.8 功能。六个 fork 沿用 rc.5 隔离候选的归档字节，正式七包重新通过精确 rc.5 Windows Desktop 启动门禁。本轮不纳入其他工作树改动，不安装或重启本机。

0.4.8 发布已使用的 local.5 执行代码：任务卡与会话行既可合法列表内排序，也可拖入另一主会话的消息区/输入区，向已有草稿插入原生会话引用，不自动发送。修复传输模块漏打包及可选 Remote 子服务访问错误；取消、切会话和真实草稿修改不误提交。合入侧栏期望宽度恢复与标题主要文字色/选中常规字重400。保留初始化、完整顺序持久化、新建置首和子agent状态修复。 六个 fork 采用 local.5 的精确已安装字节，正式0.4.8另做完整七包启动门禁；不移动旧tag，不再次安装或重启本机。本版不包含原生引用性能优化；上游讨论见 [#5043 补充反馈](<https://github.com/deepseek-ai/deepseek-harness/discussions/5043#discussioncomment-19649223>)。

0.4.7 / rc.3：发布与已安装 0.4.7-local.2 相同的执行代码。任务标题采用原生灰阶：普通及未选中 hover 使用 label-secondary，选中使用 label-primary（浅色近黑/深色近白）；保留原背景、描边、字号字重和状态色，不再引入蓝色标题。完整保留0.4.6新建置首持久化、0.4.5初始化优化及subagent状态修复，六个 fork 字节不变。本轮仅发布，不再次安装或重启本机。

0.4.6 / rc.3：明确创建成功的新任务直接前插（含复用已 Pin 空白），不读取原会话日期。创建提交期间保护前插显示，迟到 GET 不覆盖；CAS 重试重新锚定最新首项，快速创建按意图串行保存。Host 保存完整顺序，刷新/重建后恢复，除手动调整、新任务前插或移除外不重排。新增实际 Host/Client 接口链路的保存、重建、手动调整后再重建回归。保留0.4.5初始化优化和0.4.4状态/标题修复，六个 fork 原字节不变；旧 tag/assets 不覆盖。

0.4.5 / rc.3：在 0.4.4 的 subagent 活跃态和选中标题修复上，完整合入初始化优化、唯一完整顺序持久化及恢复/旧队列导入提示分离。排序不再调用 listSessions/listEvents 或读取历史首工作时间；旧 native-order schema 保持可读，旧队列只读，导入仍有副作用前栅栏与中断不重试规则。完整七包独立通过本轮启动门禁后交付；六个 fork 不改字节。0.4.4 tag 与资产保留，不覆盖。

0.4.4 / rc.3：在已验证的 0.4.2 上修复子/孙 agent 活跃时任务卡误显示 idle，并用官方主题蓝色标识当前选中会话标题。主包更新，六个 fork 保留 0.4.2 的已验证字节；完整七包有独立最终组合启动证据。0.4.3 是已安装的本地先行候选，不覆盖它的本地包或既有 tag。并行开发的排序重构明确不在这次发布中。GitHub 分发完整七包；npm 只发布 `@veewo/dsh-better-tasks` 主包，不向上游 `@deepseek-ai` scope 发布 fork，且不表示 npm 单包可独立安装。

0.4.2 / rc.3：主包声明 root/hoc 的 `sidebar.session.action`，把原生新会话内容作为第三参 children 交给渲染器；整行受创建权限保护，可选动作不增加服务硬依赖。六个 fork 按精确 rc.3 基线从最新 overlay/patch 重建，保留 workspace picker factory、问答回退、原生 Pin、导航与真实仲裁 Promise。候选使用新的完整七包、清单与独立 rc.3 Desktop 启动证据，不沿用旧 rc.3 库的接受结论。最终结果以随包 `validation.json` 为准。

0.4.1：原生新会话、紧凑导航/More/入口固定；默认强调任务名；按首次实际工作时间补正新任务顺序，保留较晚手动拖拽；rc.2 conversation 返回真实仲裁 Promise，修复斜杠提交 reading catch。主包与 conversation 改变，其他五包沿用已验证字节；不能只按 fork 的上游版本号判断字节一致。

侧栏任务泳道、原生 Pin、Final 预览、独立输入与问答卡片；rc.2 行菜单适配新的 context-menu factory slot，并透传 Workspace/quote/empty-submit 参数。包含最新 questions 修复：问答 composer 选择器失败时退出竞选，让原生输入框回退，不再用区域错误边界吞掉整个输入区。

**完整分发是七个独立 tarball，不是 bundledDependencies 或嵌套 Loader 树。** 六个 fork 保留原生包名、ModuleLoader ID、上游版本及许可证，以 Profile 根依赖安装；插件自身依赖不携带 fork。早期 `better-tasks-forks-0.2.2-rc.2` 库保留为历史资产，不覆盖，其中 questions 包并非本次最终修复字节。

## 一次性准备、构建与审计

1. 确认 GitHub 写权限、源码提交和目标运行时。保留用户未提交的工作，仅显式暂存本次发布文件。
2. 完成全部代码与文档改动，更新目标版本的验包页、[Windows Desktop 安装手册](<install-desktop.md>)、[回滚说明](<rollback.md>)、兼容矩阵和 lockfile 根版本，然后统一验证。发行包的 `INSTALL.md` 应链接到本次版本验包页及维护中的 Desktop 操作手册，避免旧资产里的操作命令成为唯一入口。
3. Node 24+ 下准备测试源码并运行 `npm run test:prepare -- --version 0.2.2-rc.3`、`npm test`、`npm run check`；对目标线运行 `node scripts/check-upstream-contract.mjs --from-tag 0.2.2-rc.3 --to-tag 0.2.2-rc.3 --version 0.2.2-rc.3`。测试源码默认线由 source lock 管理，与发布线必须分别说明。
4. 使用已审查的目标线六个 fork，检查每个包内客户端与 [fork 构建产物](<../forks-0.2.2-rc.3/>) 的哈希一致。不要误打包 npm 官方未修改模块。只有需要改变 fork 字节时才重建 fork，并重新记录来源。
5. 在新的 `releases/<组合tag>/` 打包插件本体一次；其余六包复制已验证字节。检查所有 tar 路径和包名、版本、许可、依赖、bundle patch、源码与客户端哈希。公开包仅含代码、文档和许可证，禁止任何 Profile、凭据、Session、日志、备份或工作流状态。
6. 生成 `release-manifest.json`：组合 tag、两种版本、上游来源、七个文件名/大小/archiveSha256/clientSha256。只用相对文件名，不泄露本机路径。生成 `SHA256SUMS.txt`，附 `INSTALL.md`、`ROLLBACK.md` 和脱敏 `validation.json`。清单副本保存在 provenance 下供源码 tag 追溯。

## 隔离冷启动门禁

最终七包必须在目标运行时的精确组合中冷启动。独立 DSH_HOME、Profile、Session/ledger 和 Electron user-data；禁用 `dsh-cindy-host`，监听仅 loopback，使用与安装说明相同的 isolated/hoist 策略。不得把沙盒指向真实 Profile 存储。

确认监听地址、实际浏览器核心 shell/侧栏/Session/Workspace/会话激活，无启动错误或可选服务等待死锁，并核对七个 served client 的哈希。只做启动验证，不做功能交互、截图或像素 QA。记录命令、目标版本、隔离 Profile、URL（公开证据移除 token）、浏览器错误与清理结果。退出全部自有沙盒进程并确认监听消失。失败时修复并重跑必要检查，不动真实 DSH。

## 提交、tag 与发布

审查最终 diff，通过后在 `main` 提交准确源码；只推送 `main` 与本次新 annotated tag，不用 `--tags` 批量推送历史标签，不 force push。普通源码/文档提交不创建支持 tag；未完成门禁的新线不得提前打 tag。

```powershell
# 仅在全部发布门禁通过后执行；版本必须替换为本轮已验证的新组合。
$dshVersion = '<已验证的DSH完整版本>'
$tasksVersion = '<新的Tasks版本>'
$tag = "dsh-v$dshVersion-tasks-v$tasksVersion"
if ((git branch --show-current) -ne 'main') { throw 'Release must originate from main' }
git show-ref --verify --quiet "refs/tags/$tag"
if ($LASTEXITCODE -eq 0) { throw 'Tag already exists; do not move it' }
git tag -a $tag -m "Better Tasks $tasksVersion for DSH $dshVersion"
git push origin main
git push origin "refs/tags/$tag"
# gh release create 用 --verify-tag，显式上传审计后的资产；先 draft，上传完成再公开。
```

Release 标题包含 DSH 与 Tasks 两种版本，说明链接固定到该 tag 的安装文档。上传完整七包和清单，不使用会匹配 Profile/日志的递归通配上传。发布后确认非 draft、组合 tag 对应准确提交；匿名逐个下载七包并与清单 SHA-256 对照。GitHub Release 发布与 npm 发布、真实 Profile 安装/重启互相独立，本流程不自动执行后两者。
