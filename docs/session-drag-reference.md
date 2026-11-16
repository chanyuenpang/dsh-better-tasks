# 会话／任务拖入主会话区引用（rc.3 / Tasks 0.4.8）

## 范围与 owner

会话列表和任务卡的可引用区域可以拖入当前主会话的消息内容区或 composer，无需精确命中输入框；只在主输入框草稿插入原生 Session reference chip，保留已有草稿、选区、附件与撤销，等待用户手动发送。不自动发送或切换会话，不做 Final 摘录、点击跳转或任务卡独立输入支持。任务卡按钮、文本编辑和独立输入区域仍不作为整卡拖动起点。

来源只发布临时 `application/x-dsh-session-reference+json`：`{"version":1,"sessionId":"..."}`。有界解析上限 8 KiB，只接受这两个字段，不携带正文或可信标题，不授予读取权限。可排序来源允许 `copyMove`，只可引用来源允许 `copy`；引用能力不放宽排序权限。

目标的唯一编辑 owner 仍是 conversation shell。主 InputBar 捕获真实目标、保留的编辑选区和 draftRev，使用现有原生 candidates RPC 以源 ID 查询并精确匹配；mention、名称均来自 Host，而非客户端自行编码或按标题取第一项。只经 shell 的 insertReference 编辑事务插入，并设置独立 history boundary。

原生 Host session-reference 继续负责手动发送后的上下文快照与持久化；没有新增正文、摘要、存档或权限服务。快照在 agent pre-step 准备时捕获，不是拖动时刻；沿用原生数量、自引用、读取及预算限制。普通会话链接和 Final quote 不是这条协议。

## 拖放与失败合同

- grouped／flat 会话排序只在合法行实际 drop 时提交。Session dragend 仅清理，不根据最后悬停位置补交排序；Session 拖动不再注册全 document 的 move 接受。Workspace 自身拖动合同不变。
- 列表内部 move 须匹配活动源 ID、有效传输、当前权限与原分区；主 composer copy 永不调用排序或 Pin。取消、外部目标、无效私有 payload 不转成排序。
- 主 composer 仅在 main occurrence、有可提示权限、可编辑且真实挂载可见时接收。Files 优先走原附件路径，普通文本无私有 MIME 时不拦截。无效私有引用不回退插入裸 ID；embedded／卡片输入明确拒绝此 MIME。
- 候选请求持有目标真实 Session 并绑定 AbortSignal。新 drop、切会话、切走再切回或卸载取消旧代次；草稿修改、binding／shell 变化、权限收回或源无精确候选均不应用旧结果。失败保留草稿，不尝试转投新会话；旧目标的错误不显示到新目标。
- 引用解析期间保留编辑能力；若草稿已变化则拒绝旧插入并提示重试。不会用 setDraft、直接 DOM 文本或字符串拼接覆盖原文。

## local.4 历史修复：修复拖动整体失效

local.3 的主客户端构建脚本漏打包传输模块，且跨 import 的正则把其 import 一并吞掉；所以语法检查和源码合同通过，实际任务卡 `dragstart` 却引用未定义的 `writeSessionReferenceDrag`，排序和引用均无法开始。local.4 显式打包该模块并纳入 build revision；只逐条移除已知模块 import，未知／残留 import 直接中断构建。六个 native fork 的字节不变。

回归检查执行**打包后 factory 内的真实拖动回调**，覆盖可排序来源的 `copyMove`、只引用来源的 `copy`、控件起点保护、合法 drop 排序、取消／引用后 dragend 不排序，以及全部 named import 的依赖闭包；不再仅凭源码中出现函数调用判断可用。引用仍由现有主 composer owner 解析并插入原生 chip，不改草稿或发送规则。启动检查不能发现首次拖动才触发的缺失函数，不能替代这层产物回归和用户实际拖放验收。

## local.5（0.4.8 发布基线）：修复引用拒绝并扩大接收区

local.4 修复了拖动起点，但接收端仍使用 `ctx.get('remote')?.sessionReferenceResolver`。父 Remote 是 Cordis 关联服务代理，继续访问子 namespace 会走要求 inject 的属性路径；Conversation 没有该可选硬依赖，异常又被统一失败提示掩盖。改为精确可选查询 `ctx.get('remote.sessionReferenceResolver')`，不增加启动依赖。回归使用真实 Cordis Context 复现旧访问抛错，并执行当前 InputBar drop 回调、引用 owner 和主区 router 的完整链路，而非只用普通 resolver 对象替代服务查询。

每个 ConversationContent 持有独立的 React context／router；已挂载 main InputBar 按真实目标 Session 注册，主消息区及输入区的 capture 事件只转交给这个 composer。hover 重渲染刷新回调而不重注册，不会取消正在解析的请求。嵌套 embedded、自身不匹配、卸载后或没有可见可编辑 main composer 均不误接收；进入嵌套区清除外层提示。主题 token 浮层提示整个区域可接收，文件和普通文本不拦截；无 document 级 drop 接受器，只有 dragend 的提示清理。原生草稿 revision、绑定、权限、取消及 history boundary 合同不放宽，列表 move owner 不改。

## 性能边界

手打 `@` 与拖动引用共享 DSH 原生 candidates 查询；当前用户反馈两者均慢，尚无端点分段计时或纯原生环境对照。本版没有修改其 Host 性能实现，不能宣称消除该延迟。已向[上游现有讨论补充 rc.3 反馈](<https://github.com/deepseek-ai/deepseek-harness/discussions/5043#discussioncomment-19649223>)，明确当前标题缓存为零 I/O 投影视图，而全 corpus 枚举/标签计算与文件候选合并仍是排查方向。

## 源码与交付

MIME 合同的规范实现是 [传输模块](<../src/session-reference-drag.mjs>)；rc.3 fork 源补丁嵌入一致的包内副本，保持原生源构建独立，不跨包运行时加载 Better Tasks 模块。会话源与主 composer 的具体差异仅记录在 rc.3 专用补丁，历史 variant 和补丁不变。

所有约定改动完成后统一执行聚焦 owner 合同、目标 fork 构建和七包一致性检查，不跑整套回归或浏览器视觉探针。精确候选必须独立存储、禁用 Cindy 通过 startup-only 门禁并清理后才能安装。原生 fork 非 bundle 的受控安装另获本轮确认；不自动重启或发布，实际拖放、撤销与外观由用户自行重启验收。
