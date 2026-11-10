# 提问 composer 渲染失败修复（2026-11-10）

## 根因与修复

已安装的 ui-user-questions fork 与 overlay 同时存在三个运行时遗漏：QuestionSurface 调用未导入的 useSyncExternalStore；QuestionFlow 未解构 gate/cardSurface；焦点处理和清理引用未声明的 focusOwner。补全 hook/type 导入、props 和每个挂载实例独立的 useRef owner，不修改提问协议或样式。

## 合并验证

- 六个 fork 源码构建通过；其余五个 fork 哈希不变。
- 相关回归总计 58 项通过：首轮原有 52 项通过，新 6 项测试修正测试加载器的 CommonJS interop 后通过。
- 新测试使用 React 服务端 renderer 实际执行普通/只读提问、两个 seat、锁定状态，并执行焦点 effect 的安装与清理；还验证原缺失 import/props/owner 的变体会失败。不测量 CSS、几何或截图。
- ui-user-questions runtime module edges 与官方包一致。
- 新候选独立打包于 releases/0.2.2-rc.1-question-render-20261110，不覆盖旧归档。
- client SHA256: b3d9e9ec1e069e7800ed7d59668bf2d96e1e4acd04826a0c969f50015162a141。

## 启动安全门

命令：`sandbox/desktop-startup-start.ps1 -Sandbox sandbox/.question-render-20261110 -RunId question-render`。

沙箱拥有独立 DSH_HOME、desktop profile、Session/storage/账本与 Electron user-data；复制真实 profile 的依赖锁、workspace 策略及组合，仅替换提问候选包，强制禁用 dsh-cindy-host。归一化 file 路径后，除目标包外的依赖图与真实 profile 相同。

监听地址：<http://127.0.0.1:39422>。实际 Desktop 浏览器壳所有顶层 entry 已激活；Workspace、Session、conversation 与侧栏可用，启动 failures 和浏览器 errors 均为空；六个 served fork 与候选哈希一致。沙箱只验证启动，不执行提问功能验收。

关闭并确认 main PID 52312 与 host PID 60188 已退出，39422/9228 均无监听后才改动真实 profile。完整启动与清理证据位于 sandbox/.question-render-20261110/question-render.acceptance.json 和 cleanup.json。

## 安装与交付边界

真实 profile 已备份 package/lock/workspace/user patch；pnpm 实际仅替换一个包（+1/-1）。安装后确认目标 client 哈希匹配、其余五个 fork 不变、无关依赖图未改变、wanted/installed lock 一致；不写用户 patch。安装证据位于 releases/0.2.2-rc.1-question-render-20261110/installed-verification.json。

真实 DSH 未重启，56379 监听仍属于原 host PID 40636。匿名 HTTP 访问真实 GUI 返回 401，无法据此确认现有浏览器刷新后载入的新包；不绕过认证，不声称已完成真实界面功能验收。请用户刷新并重试提问；若运行实例仍缓存旧包，需用户明确授权重启后再激活。
