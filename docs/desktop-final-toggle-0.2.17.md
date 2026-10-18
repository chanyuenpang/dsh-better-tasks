# Desktop 0.2.17 — 任务卡双击切换 Final

## 行为与边界

按用户追加要求，任务卡非交互区第二次 `click.detail === 2` 从此前的“只展开”改为切换：Final 已展开时立即折叠；折叠时仍须存在当前有效 Final 文本才展开。第一次单击即时打开 Session 不变，不增加等待窗口，也不增加会在 Final 正文卸载后误冒泡的 article `dblclick`。

- 展开态关闭不需要读 Final，即使正文正在加载、读取失败或暂无消息也能关。
- 折叠会取消该 Session 的旧 shortcut read 和 Final 正文点击 timer，晚到响应不能重开，也不能迟到切换输入。
- 同周期仅显式改变 Final 的选择；输入栏因 Final-gated 显示而隐藏，自己的开关选择与草稿保留，重新展开时恢复其显示规则。新周期仍遵循既有 input 生命周期清理，而不是引入另一个生命周期 owner。
- 保留卡片按钮/改名/链接/输入/弹窗/问题区/拖拽隔离，以及 Final 正文原单击切换输入、双击折叠行为。
- 保留[0.2.16 的当前任务抑制与重启恢复规则](<desktop-final-restore-0.2.16.md>)：native task.current 事实来源、render 前统一 effective disclosure、单调已消费 activity 水位、旧 cold snapshot 不清状态；不修改 Host Config schema、用户设置或原生 Session 所有权。

## 实现与验证

[手势控制器](<../src/client.js#L994-L1059>)先判断展开态，直接取消旧请求并调用 collapse；异步读取路径仍只做确认后的展开，不用晚到响应执行 toggle。[共享手动接线](<../src/client.js#L1226-L1261>)按最新有效周期提交显示选择，并消费该周期 marker，避免 gesture 先于 effect 落盘时手动关闭被背景新周期重置抹掉。

[双击回归](<../test/task-card-double-click.test.mjs>)更新为开→关→开，覆盖无需读取的关闭、旧请求取消/晚到拒绝、正文 timer 取消、同周期 input/Goal/Todo 选择保留，以及尚未持久化背景周期的手动折叠和 cold restart；[当前任务回归](<../test/task-final-current.test.mjs>)新增手动双击关闭与恢复检查。原单击、正文、拖拽、存储与重启回归全部保留。

完整批次统一主包 build/syntax/全量 Node regression **404/404 PASS**。[本版回归日志](<../sandbox/desktop-final-toggle-tests.log>)。只做 main-only，不改六个复用 fork，也不另加设置项或外观调整。

## 候选与部署

[新不可变候选](<../releases/0.2.17-desktop-final-toggle/candidates.json>)为 `@veewo/dsh-better-tasks@0.2.17`；沿用已安装 0.2.16 的六个精确 fork archive/client hash 和 bundle patch。沙箱 composition 从**当前**真实 Desktop profile 构建，保留同期 claw-kit canonical 包迁移等其他依赖，不恢复历史 dev-kit 状态。

- 主 archive SHA256：`bcd3c4335cf3dc3a01ba6067957db735398873530ba44c5b3f096e56377eb72d`
- 主 client SHA256：`556b36322b00e68e0796bbfdf510fb88257dc4f1d2a0d60dbb7560160440a9c6`
- Client 构建 revision：`cd4395f2e3a26c42ac34933735a3390a75be4489264919b9d721abc9f7e05079`

隔离 exact Desktop 冷启动门 **PASS**：[baseline](<../sandbox/.desktop-final-toggle-0217/baseline.json>)中的独立 DSH_HOME/profile/Session storage/ledger/Electron user-data、Cindy Host disabled、当前 canonical claw-kit composition 均保留。启动命令 `./sandbox/desktop-startup-start.ps1 -Sandbox ./sandbox/.desktop-final-toggle-0217 -RunId enabled`；sandbox 包安装使用 bundled Node/pnpm `--offline --ignore-scripts --no-frozen-lockfile`，不执行新安装脚本。

[Host 日志](<../sandbox/.desktop-final-toggle-0217/enabled.out.log>)到达 `http://127.0.0.1:39422/`；[实际 Desktop 壳检查](<../sandbox/.desktop-final-toggle-0217/enabled.acceptance.json>)确认 `dsh-app://app/` preload、所有 Client entry 与 sidebar/Session/Workspace/conversation 核心激活，errors/failures 为空，七个 served bytes 匹配候选。仅 startup，没有功能/视觉 sandbox QA。

已按 PID/命令与监听所属完整进程树核对后，经 CDP `Browser.close` 关闭，确认所有 owned processes 及 39422/9228 监听消失。[清理证据](<../sandbox/.desktop-final-toggle-0217/cleanup.acceptance.json>)。再次[安装前核对](<../releases/0.2.17-desktop-final-toggle/preinstall-consistency.json>)当前依赖图与 composition，不还原或覆盖同期 canonical claw-kit 与用户设置，并保存[安装前备份](<../releases/0.2.17-desktop-final-toggle/preinstall-backup/package.json>)。

Plugin Manager 成功安装启用 **0.2.17，restart-required**。[实装检查](<../releases/0.2.17-desktop-final-toggle/installed-verification.json>)确认 wanted/installed lock 一致、7 个候选 archive/client hashes 和 integrity 匹配、其他直接依赖与 bundle选择不变、用户 patch 未改变。[完整依赖图检查](<../releases/0.2.17-desktop-final-toggle/dependency-graph-verification.json>)确认 211 packages / 211 snapshots（含新主包）与安全冷启动沙箱逐项一致。

**已安装，等待用户重启真实 Desktop 生效并做功能/外观验收。** 代理未重启真实 Desktop；技术检查通过不意味着当前页面已加载新包或用户已确认效果。
