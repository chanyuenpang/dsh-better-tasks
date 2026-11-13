# DSH 0.2.2-rc.3 支持评估

评估日期：2026-11-14。范围：从已发布 DSH `0.2.2-rc.2` / Tasks `0.4.1` 前向适配，不改真实 Profile、不安装或重启 Desktop。

## 结论

**可以沿用现有源码分层前向适配，无须新建版本分支；但不能直接把旧 rc.3 fork 或当前 Tasks 0.4.1 标为支持。** 最小新增工作是接通新会话行 HOC，并从最新源码重建 rc.3 六包、验证精确目标组合后发布。建议下一版 Tasks `0.4.2`，目标组合 tag 为 `dsh-v0.2.2-rc.3-tasks-v0.4.2`；这是建议，尚未创建 tag 或发布。

当前公共安装入口仍为 [rc.2 / Tasks 0.4.1](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.1>)。此次合并主分支及评估不构成 rc.3 支持声明。

## 1. 官方版本与证据

- [官方 Release](<https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3>)：2026-11-13 15:56:55（Asia/Shanghai）发布，新增实验性 DeepSeek 会话导入，修复 Windows 应用内更新失败/无法重新打开。
- [官方对比](<https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.2-rc.2...dsh-v0.2.2-rc.3>)：6 个提交。目标 tag 指向 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，与[版本来源登记](<../provenance/versions.json>)一致。
- 已核对本地目标源码归档 SHA-256：`bf6d668e52a26edf98aa2ef7960e240c8d9afcefbad2b09887a2cb1e14001dd5`。GitHub compare API 的文件列表达到 300 项上限，因此另用两份固定 tag 源码直接比较本项目涉及的目录，不能只依赖 API 前 300 项。
- 当前真实运行时 manifest 仍为 rc.2；不能用它的 Inspect 或旧沙盒记录证明 rc.3 运行通过。
- 两份源码的升级指南目录没有增量变化，rc.3 没有新增 `v0.2.2-rc.2` 指南；既有 `v0.2.2-rc.1` 条目属于离开 rc.1 的迁移，不重当成此次 rc.2→rc.3 的新增要求。本轮据目标源码核实下表接点；未调用的账号、CUA、终端等迁移无需改本插件。

## 2. 真正受影响的接口

| 接点 | rc.2 → rc.3 的事实 | 本项目动作 |
|---|---|---|
| 原生侧栏新会话行 | 新增 `sidebar.session.action`，kind **hoc**、scope **root**、owner `{ wide }`；原生把 Tooltip/新会话按钮作为 `children` 传入 | 替代 root 必须声明该 child 并通过 `renderSlot(name, { wide }, { children })` 渲染；无 occupant 时保留原生按钮，权限仍由 `session/create` 控制 |
| Workspace picker | 新增 `workspace.picker` factory 与 `workspace.picker.directoryFlow` 子座位，供导入等插件复用；`WorkspacePicker.tsx`、contract、index 改变 | 保留目标上游的新注册和 picker，不复制 rc.2 整份 index 覆盖；现有 rc.3 workspace patch 作为起点 |
| Workspace 行/导航 | 此次目标源码未改动 rc.2 的行菜单/导航源文件 | 沿用 rc.2 overlay 形状，但重建时纳入最近的原生导航、Pin 等项目修复 |
| layout/questions/trigger/commands/conversation | 这五包的 `src` 在两个官方 tag 间未变；官方 client 构建预设也未变 | 可沿用源码接点，但不跨版本混用 fork tarball；questions/composer 回退和 conversation 仲裁 Promise 修复必须进入新的 rc.3 构建 |
| Session 接口 | API session-controller 的 `src` 未变；session-query 导出归档对缺失附件/流清理的实现有修改，但不改我们使用的 listEvents 接口 | 保留 native query/排序适配，不新造 Session 数据或导入业务 |
| DeepSeek 导入 | 实验性可选 bundle，通过新侧栏 HOC 入口和 workspace factory 工作 | 只恢复标准扩展接点，不硬 inject 导入服务、不默认启用，不复制导入/解析/持久化逻辑 |

官方源码锚点：[侧栏合同](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-sidebar/src/client/contract/slots.ts#L76-L86>)、[HOC 渲染](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L381-L405>)、[Workspace 注册](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-workspace/src/client/index.ts>)。

当前缺口在 [child 声明](<../src/task-model.mjs#L1-L16>)与[新会话行渲染](<../src/client.js#L1965-L1978>)：前者没有该 HOC，后者直接输出 Tooltip。因组合禁用了原生 ui-sidebar，不能指望上游替我们保留它。不能把这个座位误加为 list/single，也不能把 HOC children 当成普通 owner 字段；官方 kind/调用签名是适配合同。

## 3. 为什么旧 rc.3 产物不能直接用

[rc.3 六包目录](<../forks-0.2.2-rc.3/>)最后提交于 `e172761`。此后已有：

- `948b0b6`：问答 composer 退出竞选，让原生输入回退；
- `2d2203a`：原生导航/新会话及默认排序修复；
- `5c34bef`：Tasks 0.4.1 的实际工作时间排序与斜杠仲裁 Promise/lifetime 修复。

新的源码能复用 rc.2 overlay，不代表旧产物已自动更新。旧多版本文档的“沙盒门禁通过”只是一份历史候选记录，既没有证明最新七包，也不能凭候选包版本名证明 Host 本身运行在 rc.3；更不能替代目标 Desktop 浏览器核心激活证据。本次将 rc.3 登记状态更正为 `port-required`。

## 4. 后续实施顺序（全部在 main）

1. 在主包按精确原生合同声明并渲染 HOC；缺 provider 时安全保留新会话，不增加启动等待。保持 rc.2 的现有入口与权限行为，不引入新的任务/Pin/宽度所有者。
2. 添加离线单元/合同覆盖：HOC kind/scope、children 透传和无 occupant 回退、权限，及 workspace factory 未被 patch 丢掉。官方导入行为与视觉由用户验收，不增加沙盒功能探针。
3. 更新 Tasks 版本与 lockfile；显式指定目标线，依次检查漂移并构建：

   ```powershell
   node scripts/check-upstream-contract.mjs --from-tag 0.2.2-rc.2 --to-tag 0.2.2-rc.3 --version 0.2.2-rc.3
   node scripts/build-forks-from-source.mjs --build --version 0.2.2-rc.3
   ```

   保留[rc.3 workspace patch](<../src-patches/ui-workspace/0.2.2-rc.3-better-tasks.patch>)，不要直接修改 rc.2 的共享 patch。默认 source lock 仍为 rc.1，所有目标线命令必须显式传 `--version`，不能把默认测试线当成发布线。
4. 全部约定改动完成后，集中做构建、语法、单元/合同、externals/包身份与来源检查。合同扫描的 `attachable` **不是**侧栏 HOC、named factory、权限或完整运行时的通过证明。复核 rc.2 回归，主包共享改动不得使已有支持线退化。
5. 按[发布流程](<release.md>)打主包与 **rc.3 六包**，记录目标 runtime/tag、七包字节哈希和来源。用真正的 rc.3 Desktop/Host 和这七包冷启动：独立 Home/Profile/Session/ledger/Electron user-data、禁 Cindy；确认监听、核心浏览器 shell 激活、无启动错误/服务等待，再停止并确认清除所有自有进程/监听。若同时发布更新后的 rc.2 组合，该组合另需自己的证据。
6. 只在门禁通过且七包/清单/安装/回滚/验证证据就绪后，从 `main` 创建新的 annotated 组合 tag 和 GitHub Release。旧 tag、旧资产保持不变；真实安装和用户确认重启另行处理。

以上为后续适配方案；本轮没有执行 HOC 实现、fork 重建、rc.3 启动或发布，也没有修改当前运行的 DSH。

## 5. 分支与版本规则

`main` 是唯一开发入口；原 `release/0.3.0` 的 Tasks 0.4.1 最新提交以 fast-forward 合入，不 squash、不改写历史。旧分支只保留历史引用，不继续开发。

支持身份只用 `dsh-v<DSH版本>-tasks-v<Tasks版本>` annotated tag。一个 commit 可有多条 DSH 组合 tag，但每个 tag 必须对应自己已验证的七包；源码目录、peer 区间、分支名和 npm latest 均不是支持版本标记。详见[发布规范](<release.md>)。
