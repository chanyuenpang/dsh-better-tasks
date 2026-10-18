# Desktop 0.2.15 — 双击 Final 与当前任务自动展开策略

## 用户确认的规则

- 单击任务卡仍立即打开任务，不延迟；双击卡片非交互区，有当前有效 Final 文本才展开，已展开不折叠。
- 当前主会话正在浏览的任务进入新的 idle/Final 周期时，卡片不主动展开 Final。其他后台任务仍按 `defaultFinalExpanded`。
- 只抑制自动展开，不强制折叠显式手动展开。手动双击、Final 按钮继续有效。
- 当前周期已经抑制后，切换任务、刷新或 remount 不补触发；下一个后台周期恢复原默认策略。
- 保留 Final 正文原双击折叠、单击输入开关及按钮/输入/拖拽行为；不修改 Host 设置或原生事实 owner。

## 最小架构与实施

“当前”复用 [native 主视图投影](<../src/task-model.mjs#L112-L150>) 的 `task.current`（`retainedBy.mainView` 加非会话面板状态），不是 DOM focus、鼠标悬停、Agent 运行状态或插件自建 selected state。

[周期策略](<../src/client.js#L530-L564>)仍由 Better Tasks 的客户端 presentation 层拥有：每个新周期都消费既有 Session `updatedAt` marker。当前任务未显式展开时写该周期的 `final=false`；已有 `true` 保留。后台任务清理旧 Final/input 覆盖后回到配置默认。无新 Host 字段、storage domain、硬 inject 或原生业务事实副本。

[渲染前统一解析](<../src/client.js#L1158-L1175>)先得到有效展开 map，再用于显示、lazy Final 请求筛选和 shortcut state；[手动 toggle](<../src/client.js#L1248-L1256>)也按相同有效 map 取反。不会先按默认 true 闪开/读取 Final，再事后 effect 折叠；当前任务从抑制状态点一次 Final 按钮能真正打开。

双击复用现有 pinned-only、4000 code-point 的 Final endpoint 与 cache，异步响应按 Session/freshness/lifetime 拒绝过期结果。快捷操作仅显式设置 Final=true，不切换输入；实际代码见[请求控制器](<../src/client.js>)和[双击回归](<../test/task-card-double-click.test.mjs>)。

规则保留原 `updatedAt` 周期定义，未扩展为未经确认的原生回合序号。本策略只对本客户端观察到的 native 主视图快照负责，多个窗口各自的显示选择不是跨窗口业务事实。localStorage 不可用仍按之前的安全内存回退；不能承诺禁用存储时跨进程刷新保留手动选择。

## 合并批次验证与候选

用户在 0.2.14 单项双击候选封装后追加本规则。原[0.2.14 记录](<desktop-double-click-0.2.14.md>)保留历史，未冷启动、未安装；不能复用其 386 项测试为合并版本验收。

此次合并批次主包构建、语法和全量 Node 回归 **395/395 PASS**，没有 feature-specific sandbox 或视觉测量。[完整回归日志](<../sandbox/desktop-final-policy-tests.log>)。新增 [当前任务策略回归](<../test/task-final-current.test.mjs>)及[周期回归](<../test/final-expansion.test.mjs>)覆盖 native selection、pre-effect 不显示/不请求、手动打开优先、切换/刷新不补开、背景默认以及按钮有效状态取反。

[不可变候选清单](<../releases/0.2.15-desktop-final-policy/candidates.json>)：main-only `@veewo/dsh-better-tasks@0.2.15`，六个 fork archive/client hash 均原样复用，bundle patch 不变。
- 主 archive SHA256：`ebb8b8d030950833ceb82994c04db4f7cbcbd0317a0de20688622682cbc6c470`
- 主 client SHA256：`b6f0d17ba4c2ee245f0fcabb28f644523c0021eb3c688078e95ec92bdf626d31`
- Client 构建 revision：`dfe594c481a004a6a799a310f36cf401a8647f1cf3517ac8c12115c3bb54ba09`

## 隔离启动与交付

**0.2.15 已被重启恢复 bug 的追加修复取代，未安装到真实 Desktop。** 本候选曾完成精确 current-profile 的独立 DSH_HOME/profile/Session storage/ledger/Electron user-data 冷启动，禁 Cindy Host；Host 到达 `http://127.0.0.1:39422/`，实际 `dsh-app://app/` preload/core shell 全激活，errors/failures 均为空，七个 served bundle hash 匹配。仅 startup，不做功能/视觉 sandbox QA。[启动证据](<../sandbox/.desktop-final-policy-0215/enabled.acceptance.json>)。

用户在安装前报告“重启后所有 Final 展开状态没有恢复”。主代理停止部署，经进程/端口所有权核对后通过 CDP 关闭该沙箱，并确认整个 owned process tree 及 39422/9228 监听均消失。[清理记录](<../sandbox/.desktop-final-policy-0215/cleanup.acceptance.json>)。真实 profile 仍为 0.2.13，没有被本候选改变或重启。

395 项测试和此 startup 结果仅属于历史 0.2.15，不能代替后续合并重启修复版本的验证。新版本须重新完成必要批次验证与 exact startup gate；不重用这个不可变 archive。
