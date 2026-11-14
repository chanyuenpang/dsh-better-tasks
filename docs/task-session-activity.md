# 会话活跃状态与选中标题（Tasks 0.4.4；本地先行候选 0.4.3）

- 任务卡按原生 `useSessionStatus` 的实时 `running`（显式 `false` 优先于旧目录行）及 Session 列表基线计算状态。
- 使用原生 `projectionsBySession[id].values.subagentCatalog` 的直接子关系向上汇总，已知孙级运行也保持祖先卡片为 running。兼容旧的 summary projectionValues；不把 fork 的 parentSession 当作子 agent 关系。
- 子 agent 无需成为任务、无需出现在主 Session 列表；只有实时状态和原生目录关系即可计入。停止最后一个运行中的后代后恢复 idle。目录成员存在本身不表示正在工作，历史未闭合 turn 也不是实时运行凭据。
- 卡片颜色、StateDot、无障碍状态、idle-only Final/输入显示及中断警告共享汇总结果。主会话待交互继续优先于 running；断线仍表示状态未知，不伪装为停止成功。
- 当前选中的任务会话标题使用官方 `--dsw-alias-brand-primary`，覆盖两种标题强调模式与 hover。非选中标题、项目名及卡片状态色不变。主题变量跟随明暗主题，不固定 RGB。

实现：[状态模型](<../src/task-model.mjs>)、[任务卡](<../src/client.js>)；回归：[会话树状态与标题合同](<../test/task-session-tree-status.test.mjs>)。

这是原生已知状态的只读派生，不引入第二个执行状态所有者，不轮询、保活或唤醒子会话；缺少原生目录能力时保留主 agent 的原生状态回退。未加载/未知的远程后代不作运行推断。原生会话列表本就显示直接子 agent 的运行指示，本次不替换其业务逻辑或重建六个 fork。

构建、包审计和隔离启动记录随本地候选保存；离线测试不是功能或外观验收。用户验收前不声称视觉通过，也不自动重启真实 Desktop。
