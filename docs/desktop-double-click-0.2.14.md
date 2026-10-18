# Desktop 0.2.14 — 任务卡双击展开 Final

## 行为

- 保留第一次单击立即打开 Session；不延迟单击，不改键盘打开任务。
- 双击任务卡非交互区域时，若空闲卡片具有当前有效 Final 文本，展开 Final；已经展开时不折叠。沿用现有 Final 仅 idle 卡片显示的规则，running/等待交互卡片不动作。
- 快捷操作只写该卡的 Final 展开覆盖，不修改输入栏/Todo/Goal 覆盖。输入栏仍按其设置和原有 Final-gated 契约决定是否显示。
- Final 正文原有单击切换输入栏、双击折叠 Final 不变；卡片按钮、改名、Pin、Markdown 链接、输入框、弹窗和拖拽均不触发新快捷操作。
- 未缓存或过期的 Final 按需读取现有 pinned-only、4000 code-point 限制的 Host endpoint；确认有文本后才展开。无文本/读取失败不展开，不把“加载中/暂无 Final”误当消息；失败后可以再次双击重试。

实现使用浏览器第二次 `click` 的 `detail === 2`，而非另加延迟或冒泡 `dblclick`。这样第一次点击时机不变，而且 Final 正文在第二次点击时折叠/卸载后，不会因稍后的重定向 `dblclick` 冒泡到卡片而重新展开。

## 异步安全与实现

[请求控制器及目标过滤](<../src/client.js#L969-L1031>)按 Session/freshness 去重，使用最新任务元数据判断 idle 与 Pin 成员资格；卸载、手动切换 Final、freshness 更新、转为 running/等待交互或取消 Pin 会拒绝晚到响应，并取消相应请求。即使 transport 忽略 abort，也不发布失效结果。不读取完整 Session 到客户端、不引入新服务/硬 inject/Host schema，不改变设置持久化。

[卡片接线](<../src/client.js#L1195-L1238>)复用现有 Final cache；当前缓存直接展开，查询成功后以相同 freshness 写 ready cache，避免展开后重复查询。

[回归测试](<../test/task-card-double-click.test.mjs>)覆盖真实卡片 handler 的 single/second click、控件/拖拽过滤、缓存、无Final、幂等、请求去重、过期/取消/卸载/失败。原 Final 正文逻辑和之前默认展开修复的测试保留。

## 统一验证与候选

全量主包构建、语法检查及 Node 回归 **386/386 PASS**，一次完成整个功能批次后验证。没有 fork 改动、视觉测量或功能 sandbox QA。

- [统一回归日志](<../sandbox/desktop-double-click-tests.log>)
- [候选 inventory](<../releases/0.2.14-desktop-double-click/candidates.json>)
- 主包版本 `@veewo/dsh-better-tasks@0.2.14`，复用前版 6 个 fork archive 和同一 bundle patch。
- Client 构建 revision：`4b3af3c06455f97edc8aba9793633b4e7150dbec38fda4427e80f9d630818081`

## 安全启动与安装

**此单项候选已被用户追加需求取代，未安装，未进行冷启动。** 0.2.14 archive 和隔离 profile 准备记录仅保留作历史证据；没有启动沙箱进程。用户随后确认“当前主会话正在浏览的任务不自动展开 Final，手动双击仍有效且切换后不补触发”，并要求按 feature-architecture 实施。该规则将合并进后续不可变候选，统一验证部署，不能引用本文件的 386 项测试作为合并版本的最终验收。

后续沙箱仍须使用当前精确 composition、独立 DSH_HOME/profile/Session storage/ledger 和 Electron user-data，禁用 Cindy Host。只检查 listening URL、真实 Desktop preload/core shell activation 与启动 errors；清理所有属于沙箱的进程与监听后才能安装。代理不会重启真实 Desktop。
