# 任务视图执行中断警示

## 行为

- 沿用现有整卡颜色状态：运行绿、待交互黄、空闲灰，新增异常红色。红色使用与运行绿相同的 12% 底色、24% 边框和 58% 选中边框，当前卡片底色强化为 17%；不增加警示横幅、不改变卡片布局。
- 异常图标位于标题行既有状态图标位置，14px；悬停与无障碍标签包含结束原因及可选错误详情，不依赖 Goal、Todo、Final 的展开状态。
- 已确认的结束原因：执行失败、执行已停止、执行已中断、达到输出上限。
- 浏览器与 Host 断线或重连时显示“连接已断开 · 任务状态未知”，不把连接丢失当成后台执行已停止。
- 正常完成、等待交互、fork 收尾、未知扩展结束原因不视为失败。运行中不显示上一轮失败；新一轮开始替换旧结果。
- 已停止任务仍保留原有空闲卡片的继续/输入操作；不新增自动恢复、重试或任务状态所有者。

## 数据边界

Host 的可选 `sessionProjections` 单元 `betterTasksExecution` 从 `turn/start`、`turn/end` 折叠。状态可由 Session 日志重建并使用原生 checkpoint；Client 从现有目录 `projectionValues` 读取，不遍历会话日志，不轮询 Agent，不额外保留所有会话。

已水合的持久 open turn 在目录准备完成且 Agent 不运行时视为中断；目录未就绪、投影缺失或等待交互不作此判断。连接状态使用可选 `connection.state` 的原生订阅。错误原因按 Unicode 码点限制为 800，按普通文本渲染。

## 验证

- 同视觉语言版本统一构建/回归：429/429 通过，零失败、零跳过；JS 语法和 diff 检查通过。包含 13 项新增警示契约及红/绿卡片配方一致性契约。
- 当前候选为本机 main-only `0.2.20-dsh021.3`，保留已安装 manifest 的六个 fork 依赖和原有 bundle patch，不使用公开 0.3.2 的不同安装组合。未发布 npm。
- 沙箱使用 `sandbox/.task-execution-0.2.20-dsh021.3/home`、独立 desktop Profile/Session/ledger；Cindy Host 被禁用。安装和启动证据位于该沙箱，必须成功完成冷启动且清理后才允许真实安装。
- 此前 `0.2.19-dsh021.3` 的横幅候选已通过相同冷启动门并安装，用户随后要求沿用既有颜色状态，本轮移除横幅。该旧候选不能代表新版的启动/交付证据。
- 自动检查不包含截图、像素/几何/CSS 计算或功能沙箱 QA；外观和真实使用由用户验收。

## 0.2.20 交付结果

- 安装组合：main-only `0.2.20-dsh021.3`，沿用六个原有 immutable fork；规范化完整 lock 一致，所有七个 Client SHA-256 与冷启动候选相同。
- 冷启动命令：`sandbox/desktop-startup-start.ps1 -Sandbox sandbox/.task-execution-0.2.20-dsh021.3 -RunId enabled`；Profile 为独立 home 下的 `desktop`，Electron 使用独立 user-data。
- Host 监听 `http://127.0.0.1:39422/`，实际浏览器壳为 `dsh-app://app/`：全部 Client entries 激活，根/侧栏/Session/Workspace/conversation 可用，failures 和浏览器 errors 均为空，七个实际服务的前端产物逐一匹配。
- 清理完成后确认沙箱 root 20188、Host 84248、所有路径匹配进程及 39422/9228/9231 监听均不存在。
- Plugin Manager 安装返回 `application: applied`、版本 `0.2.20-dsh021.3`、零管理器警告；仅替换主包。安装后精确 lock 与七产物复核通过；原有插件组合保持不变，用户并发将默认模型 reasoningEffort 从 high 改为 medium 的设置被保留，未覆盖。
- 未重启真实 DSH；真实 Config 仍注册可用。安装结果不是用户外观/功能验收，本轮不宣称用户已验收。原插件显示 metadata 保持不变，此次仅修改既有任务卡状态表达。
