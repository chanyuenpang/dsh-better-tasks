# 会话活跃状态与选中标题（Tasks 0.4.7）

- 任务卡按原生 `useSessionStatus` 的实时 `running`（显式 `false` 优先于旧目录行）及 Session 列表基线计算状态。
- 使用原生 `projectionsBySession[id].values.subagentCatalog` 的直接子关系向上汇总，已知孙级运行也保持祖先卡片为 running。兼容旧的 summary projectionValues；不把 fork 的 parentSession 当作子 agent 关系。
- 子 agent 无需成为任务、无需出现在主 Session 列表；只有实时状态和原生目录关系即可计入。停止最后一个运行中的后代后恢复 idle。目录成员存在本身不表示正在工作，历史未闭合 turn 也不是实时运行凭据。
- 卡片颜色、StateDot、无障碍状态、idle-only Final/输入显示及中断警告共享汇总结果。主会话待交互继续优先于 running；断线仍表示状态未知，不伪装为停止成功。
- 任务标题采用灰阶区分选中状态：未选中使用原生 `--dsw-alias-label-secondary`（浅色深灰、深色灰色），选中使用 `--dsw-alias-label-primary`（浅色近黑、深色近白）。两种标题强调模式一致；hover 只保留原有下划线，不提升未选中标题的颜色。字号、字重、项目名、卡片背景/描边和状态色、选中判定及排序逻辑都不变。彩色仅留给原有运行/警告等状态。`0.4.7` 正式组合沿用已本地安装的 `0.4.7-local.2` 执行代码；发布不代表本轮重新安装、Desktop 重启或用户外观验收。
- 历史：`0.4.7-local.1` 曾用 `--dsw-alias-link` 实现选中标题蓝色；用户随后确认蓝色会与面板状态色冲突，改用上述灰阶方案。rc.3 的 `--dsw-alias-brand-primary` 为中性色，不能把它当作蓝色 token。

实现：[状态模型](<../src/task-model.mjs>)、[任务卡](<../src/client.js>)；回归：[会话树状态与标题合同](<../test/task-session-tree-status.test.mjs>)。

这是原生已知状态的只读派生，不引入第二个执行状态所有者，不轮询、保活或唤醒子会话；缺少原生目录能力时保留主 agent 的原生状态回退。未加载/未知的远程后代不作运行推断。原生会话列表本就显示直接子 agent 的运行指示，本次不替换其业务逻辑或重建六个 fork。

构建、包审计和隔离启动记录随 Release 的验证证据交付；离线测试不是功能或外观验收。用户验收前不声称视觉通过，也不自动重启真实 Desktop。
