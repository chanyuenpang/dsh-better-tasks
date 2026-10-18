# Desktop 0.2.13 — 默认展开与设置修复

## 修复范围

基于[审查报告](<settings-review-2026-10-01.md>)，只修改 Better Tasks 主包客户端，不修改 Host Config schema、用户配置、原生 Session/Goal/Todo 所有权或六个已接受的 fork。

- [Todo 生命周期](<../src/client.js#L585-L614>)按 Goal ID 和有序清单正文识别；仅进度、名称、时间戳变化不重置。新清单、新 Goal、已结束 Goal/已清空清单恢复默认；暂时未知的投影不抹掉手动选择。
- [输入栏生命周期](<../src/client.js#L530-L551>)和 Final 使用同一既有 idle 周期。新周期清理 Final/input 覆盖，不改 Todo/Goal、不主动清理输入草稿。折叠 Final 仍只是隐藏输入。
- [生命周期接线](<../src/client.js#L1068-L1089>)使用函数式更新，多个周期同一 commit 更新时不会互相覆盖。
- [Desktop 安全存储](<../src/client.js#L641-L697>)保留 Electron `dsh-app` renderer 的 localStorage 用于轻量、每客户端展开记录。读取、legacy 迁移、属性 getter、写入失败均安全降级；无存储时仍使用 React 内存状态。Host ConfigForms 继续持久化 8 个默认设置，不搬到 Electron 缓存、不新增 IPC/文件持久化接口或硬依赖。
- 周期记录读取上限由 100 提高到 300，与展开记录上限对齐，避免刷新时仍存在展开覆盖却丢失其周期标识。
- 中英文提示注明快速消息栏依赖 idle+Final，并包含问题区字体范围和周期重置规则。

### 迁移与兼容

继续使用原展开记录 key、Goal/Final 周期 key 和 Host 设置命名空间。新增 Todo 周期 key `dsh-better-tasks.todo-expansion-cycle.v1`；第一次读到完整、确定的 Todo/Goal 投影时，无法绑定生命周期的历史 Todo 覆盖清理一次，以配置默认值为准。之后同周期的手动选择跨刷新保留。已有 input 覆盖会在下一新 idle 周期清理，不强制在升级当下清空同周期选择。

本轮保留 Final 原有 `updatedAt` 周期定义。[原审查](<settings-review-2026-10-01.md>)中的元数据触发风险未被确认为原生 bug；本轮不臆造原生回合标识，也不宣称已经改成基于回合序号。相同 Goal 且清单正文完全相同的 Todo 重发没有额外版本 ID，视为同一清单，避免进度更新引发不必要折叠。

## 统一验证

一次完整批次的主包构建、语法检查、全量 Node 回归：**367/367 PASS**。其中新增生命周期、存储无权限/getter 抛错/缺失/损坏/legacy 与刷新容量测试，并保留 Host ConfigForms 写拒绝恢复测试。

- [完整回归日志](<../sandbox/desktop-settings-tests.log>)
- [生命周期回归](<../test/final-expansion.test.mjs>)
- [存储/文案回归](<../test/task-disclosure-storage.test.mjs>)
- [边界复现转回归脚本](<../sandbox/settings-review-repro.mjs>)

`verify-fork-externals` 的三个基础 fork 模块边界 PASS；封装脚本另外验证六个复用 fork 的 archive 与当前构建 client hash 不变。未构建任何 fork，也未执行视觉测量。

## 唯一不可变候选

[候选清单](<../releases/0.2.13-desktop-settings/candidates.json>)；只更换 `@veewo/dsh-better-tasks@0.2.13`，沿用 0.2.12 的六个精确依赖 archive 与相同 bundle patch。

- 主 archive SHA-256：`04db11635433f96a6cea24477f768885b24dabfb4add3ea204b1dee4a94f3d84`
- 主 client SHA-256：`0412640c09dbf4f76e8da67145c567a7f4e03975d1e7ecf0a55d0d77f9223f11`
- Client 源构建 revision：`d418a0d249e9205d4d3348563e77af0d4d6aae9204b934d9837e31f9df728b16`

## 冷启动与安装状态

隔离 Desktop 冷启动安全门 **PASS**：Host 到达 `http://127.0.0.1:39422/`，实际 `dsh-app://app/` renderer 和 Desktop preload 正常；全部 top-level Client entry 激活，Sidebar/Session/Workspace/conversation 核心壳可用，模块 failures 和捕获的浏览器 errors 均为空。七个 served client 的实际执行字节与候选 hash 一致。只做 startup 检查，没有任务功能/外观交互验收。

[启动验收记录](<../sandbox/.desktop-settings-0213/enabled.acceptance.json>)、[Host 日志](<../sandbox/.desktop-settings-0213/enabled.out.log>)、[browser stderr](<../sandbox/.desktop-settings-0213/enabled.err.log>)。

启动命令：`./sandbox/desktop-startup-start.ps1 -Sandbox ./sandbox/.desktop-settings-0213 -RunId enabled`。安装沙箱 profile 使用 bundled Node+pnpm 的 `install --offline --ignore-scripts --no-frozen-lockfile`，无新安装脚本执行。一次额外的模块检查 CLI 调用使用了不支持的 `--slugs` 参数；纠正为读取沙箱实装六个包并调用公开的 `assertForkExternals` 后，六项全部 PASS；没有重构建、重封装或重启沙箱。[实装模块边界记录](<../releases/0.2.13-desktop-settings/sandbox-module-edges.json>)。

沙箱通过 CDP `Browser.close` 关闭；先核对 9228/39422 监听属于记录的完整进程树，再确认所有拥有的进程与这两个监听端口都消失。[清理记录](<../sandbox/.desktop-settings-0213/cleanup.acceptance.json>)。真实 Desktop 没有被代理停止或重启。

清理后再次执行[安装前依赖/组成核对](<../releases/0.2.13-desktop-settings/preinstall-consistency.json>)：与冷启动 composition 一致，只允许主包变更。已保存[安装前备份](<../releases/0.2.13-desktop-settings/preinstall-backup/package.json>)，由 Plugin Manager 成功安装启用 `@veewo/dsh-better-tasks@0.2.13`，结果为 **restart-required**。[安装验证](<../releases/0.2.13-desktop-settings/installed-verification.json>)确认 wanted 与 installed lock 相同、七个候选 archive/client hash 与 integrity 匹配、其他直接依赖与 bundle 选择不变、用户 patch 未改变。

[完整依赖图核对](<../releases/0.2.13-desktop-settings/dependency-graph-verification.json>)另确认真实实装的 **211 个 packages / 211 个 snapshots**（含新主包）逐项等于安全冷启动沙箱的图，不只是检查直接依赖。

**已安装，等待用户重启 Desktop 后生效并进行功能/外观验收。** 安装成功和沙箱启动通过不代表真实页面已经加载新包。

沙箱使用 [baseline](<../sandbox/.desktop-settings-0213/baseline.json>) 中独立的 `DSH_HOME`、desktop profile、Session storage/ledger，以及全新的 Electron user-data。继承当前真实 composition 和依赖锁，仅更换候选主包，并追加禁用 Cindy Host 与沙箱 39422 端口。安装只发生在沙箱配置；真实 Desktop 不由代理重启。
