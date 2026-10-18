# Desktop 0.2.16 — Final 交互与重启恢复合并修复

## 问题、边界与不变量

本批合并三项用户要求：单击任务卡即时打开不变，双击非控件区有有效 Final 则幂等展开；当前主会话正在浏览的任务进入新周期不主动展开、手动选择优先、切走不补展开；修复重启后原有 Final 展开/折叠记录被清理。

已有[只读 feature-architecture 设计](<../.claw/tasks/2026-10-01/任务卡双击展开Final/feature-architecture/2026-10-01-1634-任务卡双击与焦点Final抑制.md>)已纳入 claw plan。此文补充用户后报重启 bug 的确证与最小修复，不平行引入 owner、Host 字段、IPC/文件存储接口或 native round ID。Host Config 仍持久化默认设置；客户端轻量 disclosure/localStorage owner 不变，无用户记录清空或强制设置默认。

## 原因与唯一事实来源

主代理对[固定 native 0.2.0-rc.2 源码版本](<../provenance/source.lock.json#L3-L9>)定向取证：

- [冷目录投影读取](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/api/session-controller/src/list.ts#L269-L306>)允许缺少 `sessionListMetadata`；[summary 时间计算](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/api/session-controller/src/list.ts#L327-L329>)是 `max(header.createdAt, lastPromptAt ?? 0)`，cache miss 时会暂时退回创建时间。
- [客户端 hydration 合并](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/api/session-controller/src/client/sessions/manager.ts#L752-L765>)后才恢复较新的 `lastPromptAt`。数字类型由 native SessionSummary 合同定义，非 Date 对象或任意序号。
- [活动事件](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/api/session-controller/src/index.ts#L186-L197>)仅在实际用户消息时发布其 event.time；所以旧快照回退不是新活动的证据，不应丢弃手动选择。

修复前 Node 复现：持久周期 `100`、Final 折叠 `false` → 冷目录 `10` 被旧“不相等就是新周期”判断消费并清掉 false、marker 降到 10 → hydration 回到 100 又重置一次，默认 true 导致展开。这证明了源码缺陷和用户症状的吻合；没有宣称自动复现了用户真实 Desktop 的完整重启。

## 推荐决策与失败路径

[Final 周期实现](<../src/client.js#L530-L573>)使用单调已消费活动水位：只有有效数字时间严格大于已消费值才是新周期；相等、回退、未知/非法时间不清理 disclosure、不降低 marker。第一次没有数字 marker 时按当前已知合法活动初始化。保留真正新用户活动后的默认恢复规则，当前任务抑制也受同一周期规则保护。

同步有效 disclosure 继续用于渲染、懒读和手动 toggle/shortcut，避免 effect 之前的闪开和错误操作取反。控制器仍按 Session/freshness/lifetime 过滤晚到响应；按钮/输入/拖拽/Final 正文旧交互保留。

关键失败路径：重启先读旧冷目录，再接收到新鲜投影。此路径必须原样保留保存的 true/false 和水位；若随后真有 `101` 新活动，再重置到设置默认。localStorage 禁用时依旧安全退回内存，不承诺无存储环境跨进程恢复；但不能再把正常 cold hydration 当新周期。未新增或偷偷写回 native Session 元数据。

## 最小切片、验证与交付

完成当前三项同批变更后统一验证；[周期回归](<../test/final-expansion.test.mjs>)覆盖冷→热、单调水位、未知时间、新活动与当前任务抑制；[真实 key 读取回归](<../test/task-disclosure-storage.test.mjs>)覆盖新 renderer 读取保存的 disclosure/cycle 再 hydration；[手动/焦点规则](<../test/task-final-current.test.mjs>)和[双击合同](<../test/task-card-double-click.test.mjs>)保留。

统一主包构建、语法检查及全量 Node 回归 **400/400 PASS**。[本版回归日志](<../sandbox/desktop-final-restore-tests.log>)。[新不可变候选](<../releases/0.2.16-desktop-final-restore/candidates.json>)只改主包，六个 fork 的 archive/client hash 及 bundle patch 不变。

- 主 archive SHA256：`2e22a28b377f7514b19a466b5bf0ae6717e4ade773c34809bd1e52448decd637`
- 主 client SHA256：`b65344d172003cce5f873f291267d714219123e8f3fb5fefa4394831efd57316`
- Client 源构建 revision：`d43eb525f6547b368ce083fe67a3039c6c71254357a1ddc066e626556c01ddc3`

旧 [0.2.14](<desktop-double-click-0.2.14.md>)/[0.2.15](<desktop-final-policy-0.2.15.md>)未安装，仅保留历史，后者沙箱已完全清理。

0.2.16 exact Desktop 冷启动门 **PASS**：[baseline](<../sandbox/.desktop-final-restore-0216/baseline.json>)使用当前实装依赖图+本候选，独立 DSH_HOME/profile/Session storage/ledger/Electron user-data，Cindy disabled。启动命令 `./sandbox/desktop-startup-start.ps1 -Sandbox ./sandbox/.desktop-final-restore-0216 -RunId enabled`；离线 sandbox 包安装通过 bundled Node/pnpm、`--ignore-scripts`，无新安装脚本执行。

[Host listening 日志](<../sandbox/.desktop-final-restore-0216/enabled.out.log>)到达 `http://127.0.0.1:39422/`；[实际 Desktop startup 验收](<../sandbox/.desktop-final-restore-0216/enabled.acceptance.json>)确认 `dsh-app://app/` preload/core shell（sidebar、Session、Workspace、conversation）全激活，failures/errors 为空，七个 served bundle 字节与候选匹配。没有 sandbox 功能/视觉 QA。

沙箱经 PID/命令与端口所属进程树核对后通过 CDP `Browser.close` 关闭，完整 owned tree 及 39422/9228 监听均已消失。[清理证据](<../sandbox/.desktop-final-restore-0216/cleanup.acceptance.json>)。之后重新执行[部署前精确图核对](<../releases/0.2.16-desktop-final-restore/preinstall-consistency.json>)并保存[当前安装前备份](<../releases/0.2.16-desktop-final-restore/preinstall-backup/package.json>)。

Plugin Manager 成功安装启用主包 **0.2.16，restart-required**。[实装验证](<../releases/0.2.16-desktop-final-restore/installed-verification.json>)确认 wanted/installed locks 一致、7 个 archive/client hash 与 lock integrity 匹配，其他直接依赖/bundle选择不变，用户 patch 没有改变。[完整依赖图验证](<../releases/0.2.16-desktop-final-restore/dependency-graph-verification.json>)确认 211 packages / 211 snapshots（含新主包）与安全启动沙箱逐项相同。

**已安装，尚待用户重启真实 Desktop 生效与功能/外观验收。** 代理未停止或重启真实 Desktop；startup/unit/包检查不代表当前页面已经加载新包或用户已接受效果。旧版本若已经覆盖/清掉某次手动选择，本版不能凭空恢复那个历史记录；需要重新设一次，后续正常同周期重启不应再因旧目录快照抹掉它。
