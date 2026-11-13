# Better Tasks for DSH Desktop

DSH 侧栏任务泳道：共享原生 Pin、独立任务输入、Final 预览与任务卡片问答。

## 按 DSH 版本安装

**当前公开分发组合：DSH Desktop `0.2.2-rc.2` + Better Tasks `0.4.1`。**

0.4.1 包含新任务排序与斜杠提交修复，必须同步更新主包和本 Release 的 conversation fork，见[安装说明](<docs/install.md>)。旧 [0.4.0 组合](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.0>)保留供回滚。

| DSH Desktop 运行时 | Better Tasks | 完整安装入口 |
|---|---|---|
| `0.2.2-rc.2` | `0.4.1` | [dsh-v0.2.2-rc.2-tasks-v0.4.1](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.1>)（含输入框回退修复） |
| `0.2.1-rc.2` | `0.3.2` | [历史插件](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.2>) + [对应 fork 库](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/better-tasks-forks-0.2.1-rc.2-r1>) |
| `0.2.0-rc.2` | `0.3.1` | [历史发行版](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.1>) |

新 tag 统一为 **`dsh-v<DSH版本>-tasks-v<Tasks版本>`**。先确认 Desktop「关于」中的完整运行时版本，再选对应 Release；同一 DSH 线的 Tasks 更新会创建新的组合 tag，旧包保留供回滚。不要跨 rc.1 / rc.2 / rc.3 混装，也不要仅按 GitHub 的 Latest 或 npm latest 安装。

**完整安装 = 插件本体 + 同一 Release 的六个 UI fork，共 7 个 `.tgz`。** 源码 ZIP 和单独 npm 包都不是完整安装包。六个 fork 保留原生包名，属于本项目兼容性修改，并非 DeepSeek 官方发行包。

1. 从[当前 Release](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.1>)取齐七包、`release-manifest.json`、`SHA256SUMS.txt` 和 `INSTALL.md`。
2. 按[安装说明](<docs/install.md>)校验并备份自己的 Profile，配置 `nodeLinker: isolated` 与六个精确的 `publicHoistPattern`。
3. 完全退出 Desktop（含托盘），安装七包，再手动启动验收。升级与卸载见[回滚说明](<docs/rollback.md>)。

本次完整 Release 包含最新 `ui-user-questions` 修复。较早的 `better-tasks-forks-0.2.2-rc.2` 是历史 fork 库，不含这次最终修复，不要与本次七包混用。

## Features

- Switch between the native Session browser and a task swimlane in the same sidebar; native search, Workspace grouping, rename, archive and directory operations remain.
- Native Pin membership is shared with official Session rows. Better Tasks persists a separate task-card order, not a second membership truth. New Session paths use the same native action and auto-Pin lifecycle hook.
- Cards keep the native running StateDot, localized relative time and current main-view selection. Clicking a card immediately opens its Session. Double-clicking its non-interactive area toggles Final: close immediately when expanded; open only when a current, nonempty Final preview is available.
- Final is a bounded, read-only Host projection (up to 4000 Unicode code points). The currently browsed task does not automatically expand Final for a new idle cycle; manual choices win, and navigation does not retroactively expand it. Cold startup catalog fallback/hydration does not erase saved choices or lower the consumed activity watermark.
- Independent native input surfaces let pinned idle tasks receive messages, commands and skill insertion without changing the main view. Hidden input retains its draft. Ordinary native questions can be answered inside cards through the same draft/settlement owner; plan-review approval stays in its native panel.
- Host-backed settings configure detail/question text size (11–16), default disclosures, native/tasks view, task/project title emphasis, and auto/single/double columns. Auto uses two independent vertical flows only above 528px. Input remains subordinate to expanded Final, rather than pretending every disclosure is display-independent.
- Native layout owns sidebar width and collapse. Its last positive width is retained. Windows caption controls remain reachable at zero-width collapse; macOS uses the legal frame-owned `shell.leading` reopen/New Session seat. Browser-style rails keep their existing behavior.

## Distribution and provenance

Each combined release freezes one plugin version and six forks built for the exact upstream DSH tag. Original package names, ModuleLoader identities and licenses are retained; nothing is published to the upstream `@deepseek-ai` npm scope. The release includes sanitized archive/client SHA-256 values and upstream provenance. Existing tags and download URLs are never overwritten.

Source patches live under [src-patches](<src-patches/>), project-owned modules under [src-overlay](<src-overlay/>), and per-line upstream source facts in [versions](<provenance/versions.json>). For the forward-port procedure see [upgrading DSH](<docs/upgrading-dsh-version.md>) and [fork layers](<docs/fork-layers.md>). Release assets contain no real Profile backups, Session stores, credentials, runtime logs or workflow state.

## Development

**仅在 `main` 上开发和提交**；不再维护按功能、发布或 DSH 版本划分的长期分支。已有分支仅保留历史引用。支持版本只由 `main` 上不可变的 `dsh-v<DSH版本>-tasks-v<Tasks版本>` annotated tag 与完整 Release 标记，`main` 的最新提交不等于已经发布或适配完成，详见[发布规范](<docs/release.md>)。

**rc.3 开发候选：Tasks `0.4.2` / DSH `0.2.2-rc.3`。** 已接通原生新会话行 HOC，并从最新源码准备六个 rc.3 fork；完整七包及 `validation.json` 的精确目标启动结果随候选交付，见[rc.3 安装说明](<docs/install-rc3.md>)和[适配记录](<docs/dsh-0.2.2-rc.3-support.md>)。这不是 npm/GitHub Release 已发布声明；公开 rc.2 入口保持不变，不混装旧 rc.3 产物。

侧栏新增按钮、调整排版或适配新 DSH 前，先遵循[侧栏排版与适配规范](<docs/sidebar-layout.md>)；数字、原生语义样式与版本合同分层维护。

Use Node **24+** for the source-contract tests (`stripTypeScriptTypes`) and install developer dependencies:

```powershell
npm ci --ignore-scripts
npm run test:prepare  # stage pinned, patched TS test sources; does not rebuild fork artifacts
npm test             # build the main client, then run unit/contract tests
npm run check
```

`npm run build:fork` is a deliberate source-fork rebuild for development, not a routine main release step. It uses the pinned upstream tag and official preset; revalidate changed bytes before deployment. `.srcbuild/` is generated and ignored. Never point a real Profile at the mutable checkout.

Technical unit/package/startup checks do not replace user acceptance. Desktop candidates must cold-start in isolated storage with Cindy disabled, and every sandbox process/listener must be removed before real installation. Functional and appearance acceptance belong to the user; the agent does not automatically restart the real Desktop.
