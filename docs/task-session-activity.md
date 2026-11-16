# 会话活跃状态与选中标题（Tasks 0.4.8）

- 任务卡按原生 `useSessionStatus` 的实时 `running`（显式 `false` 优先于旧目录行）及 Session 列表基线计算状态。
- 使用原生 `projectionsBySession[id].values.subagentCatalog` 的直接子关系向上汇总，已知孙级运行也保持祖先卡片为 running。兼容旧的 summary projectionValues；不把 fork 的 parentSession 当作子 agent 关系。
- 子 agent 无需成为任务、无需出现在主 Session 列表；只有实时状态和原生目录关系即可计入。停止最后一个运行中的后代后恢复 idle。目录成员存在本身不表示正在工作，历史未闭合 turn 也不是实时运行凭据。
- 卡片颜色、StateDot、无障碍状态、idle-only Final/输入显示及中断警告共享汇总结果。主会话待交互继续优先于 running；断线仍表示状态未知，不伪装为停止成功。
- 当前 `0.4.8`（执行代码沿用 local.5） 将所有任务标题统一为原生 `--dsw-alias-label-primary`（浅色近黑、深色近白），不再以标题颜色区分选中。普通标题使用原有加粗字重 680，选中标题覆盖为常规字重 400；两种标题强调模式与 hover 一致。字号、字体家族、项目标签、卡片背景/描边及状态色、选中判定和排序逻辑均不变。彩色仍仅用于原有运行/警告等状态。正式组合的发布与启动证据随 Release 交付；不自动重启 Desktop，也不代替用户外观验收。
- 公开 `0.4.7` 保留未选中次级色/选中主要色的灰阶合同；0.4.8 在用户后续要求下统一标题颜色、改用字重区分选中，不覆盖旧 Release。
- 历史：`0.4.7-local.1` 曾用 `--dsw-alias-link` 实现选中标题蓝色；用户随后确认蓝色会与面板状态色冲突，改用上述灰阶方案。rc.3 的 `--dsw-alias-brand-primary` 为中性色，不能把它当作蓝色 token。

实现：[状态模型](<../src/task-model.mjs>)、[任务卡](<../src/client.js>)；回归：[会话树状态与标题合同](<../test/task-session-tree-status.test.mjs>)。

这是原生已知状态的只读派生，不引入第二个执行状态所有者，不轮询、保活或唤醒子会话；缺少原生目录能力时保留主 agent 的原生状态回退。未加载/未知的远程后代不作运行推断。原生会话列表本就显示直接子 agent 的运行指示，本次不替换其业务逻辑或重建六个 fork。

本地候选保存构建、包审计和隔离启动记录；公开版本随 Release 交付验证证据；离线测试不是功能或外观验收。用户验收前不声称视觉通过，也不自动重启真实 Desktop。
