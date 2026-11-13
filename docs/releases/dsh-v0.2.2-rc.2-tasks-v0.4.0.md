# Better Tasks 0.4.0 · DSH 0.2.2-rc.2

**请先确认 Desktop 的 DSH 运行时为 `0.2.2-rc.2`，再安装本发行版。** 不适用于 rc.1 / rc.3 或其他线。

- 组合 tag：`dsh-v0.2.2-rc.2-tasks-v0.4.0`。
- 今后统一按 `dsh-v<DSH版本>-tasks-v<Tasks版本>` 查找；两种版本独立管理，不要只选 Latest。
- 本次为 RC 运行时的配套 Pre-release；发布验证限定 Windows Desktop，其他平台尚未在本次验证。

## 包含什么

侧栏任务泳道、原生 Pin、Final 预览、独立任务输入和问答卡片，以及 rc.2 的菜单与输入接口适配。

本次包含最新 questions 修复：问答 composer 选择器失败时让出插槽，由原生输入框回退，避免异常占住整个会话输入区。历史 `better-tasks-forks-0.2.2-rc.2` 的 questions 包早于此修复，保持原样留档，请勿混装。

## 安装

1. 在下方 Assets 取齐 **7 个 `.tgz`**，以及 `release-manifest.json`、`SHA256SUMS.txt`、`INSTALL.md`、`ROLLBACK.md`。
2. 按[本版本安装说明](<https://github.com/chanyuenpang/dsh-better-tasks/blob/dsh-v0.2.2-rc.2-tasks-v0.4.0/docs/install.md>)下载与校验，备份自己的 Profile。
3. 手动完全退出 Desktop（含托盘）；合并 `nodeLinker: isolated`、`autoInstallPeers: false` 与六个精确的 `publicHoistPattern`，然后安装七包，手动启动验收。

**单装 npm 包不完整。GitHub 的 Source code ZIP/TAR 也不是安装包。** 六个 fork 为本项目的兼容性修改，保留官方包名和 MIT 许可，但不是官方 npm 发布。

## 验证与回滚

随附 `validation.json` 记录必要回归、rc.2 契约检查、七包审计与隔离冷启动的实际结果；功能和外观仍由使用者验收。`release-manifest.json` 含上游源码来源、两种版本与七包 SHA-256，无真实 Profile/Session/凭据。

卸载时同时移除插件和六个 fork，避免继续遮蔽官方模块；恢复步骤见[本版本回滚说明](<https://github.com/chanyuenpang/dsh-better-tasks/blob/dsh-v0.2.2-rc.2-tasks-v0.4.0/docs/rollback.md>)。不要删除会话、Workspace、Pin、Tasks 设置或 ledger。
