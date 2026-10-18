# Desktop 0.2.18 — 侧栏收起后重新展开入口

## 根因与边界

本插件接管 sidebar root 并禁用 native ui-sidebar，但之前只保留列内的重开按钮，遗漏原生 Desktop 的列外 chrome 合同。

- [已接受 layout fork](<../forks-0.2.0-rc.2/ui-layout/lib/client.js#L354-L360>)在 Windows `data-windows-titlebar` 和 macOS 下将收起列宽设为 0，不保留 browser rail；[frame](<../forks-0.2.0-rc.2/ui-layout/lib/client.js#L418-L470>)仍挂载 sidebar 子树，但零宽 column 的 overflow clip 隐藏普通列内按钮。
- [原生 Windows sidebar CSS](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/client/ui-sidebar/src/client/SidebarRoot.module.css#L38-L118>)把原按钮放到 caption：fixed、原标题栏高度变量、28px control、left 12/48、z-index 30、no-drag，并保留菜单起始空隙。原生[根组件](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L103-L117>)在 Windows 收起首帧立即使用 narrow 状态，不等 rail settle。
- [原生注册](<C:/Users/chany/AppData/Local/Temp/dsh-src-dsh-v0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/packages/client/ui-sidebar/src/client/index.ts#L90-L98>)还为 macOS `shell.leading` 提供 reopen/New Session。live Slot Inspect 确认当前 `shell.leading` 声明可用但无 occupant。其是否显示、位置和 traffic-light clearance 由 frame 决定，不能让插件另建布局事实。

本轮复用上述合同，不修改 layout fork、sidebar 的最后正宽度/收起 state、main/root Slot 或原生数据；不把收起宽度强制改成假 rail，不用 DOM injection/portal button，不增加新的硬 inject/业务接口。

## 最小修复

[主客户端](<../src/client.js>)仅新增 Desktop 适配：

- Windows 现有 toggle 按钮成为 native-caption fixed 控件，始终有 Panel 图标和 no-drag 点击区域；collapsed New Session 同样移到原 caption 座位。菜单 clearance 为 native 的 84px，选择器限定 Windows 属性和本插件 sidebar。
- Windows 不等待 150ms rail settle 就进入 collapsed 展示；tooltip 使用底部、native portal 支持以避开零宽列裁剪。普通 browser/legacy rail 和 hover mark 不变。
- 注册现有 root-scoped `shell.leading` 的 `SidebarReopenControls`，复用 native layout.toggleSidebar 和 uiWorkspace.startSession；不创建 root 或声明额外 child seats，无 Session hook / 焦点/宽度/收起本地 store。frame 只在 macOS 完全隐藏 sidebar 时显示该 chrome seat，因此这里无第二个 visibility owner。
- 使用原生 button、动态可访问名称和 aria-expanded，保持标准键盘激活；六个兼容 child seats、任务卡/Final/Pin/设置、最后正宽度恢复均不改。

必要检索由 claw search 先尝试，但 embedding generation 失败。本轮直接读取项目与固定[0.2.0-rc.2 源码版本](<../provenance/source.lock.json>)定位，无编造召回结果或研究子代理。

## 批次验证

[重开回归](<../test/sidebar-reopen.test.mjs>)在 Node 中执行真实组件逻辑：Windows 0-width/cold collapse/settling 两相、动态 aria/原生 toggle、新建 Session、browser rail、缺失 document 安全分支、无需 Session 的 shell.leading；只静态检查 native CSS 规则，不执行 computed CSS、geometry、pixel 或截图测量。[注册回归](<../test/client-contract.test.mjs>)确认仍唯一 sidebar root、六 child seats、合法 shell.leading callback 及 native action owner，不注册/替换 root。

完整批次统一 build/syntax/全量 Node regression **413/413 PASS**。[本版回归日志](<../sandbox/desktop-sidebar-reopen-tests.log>)。[新不可变 main-only 候选](<../releases/0.2.18-desktop-sidebar-reopen/candidates.json>)为 `@veewo/dsh-better-tasks@0.2.18`，六个 accepted fork archive/client 及 bundle patch 原样复用，不构建或更换 fork。

- 主 archive SHA256：`2b990a2d5824493c07051b5d703200e300fe4cbb82b0e31d54c84c7632a87108`
- 主 client SHA256：`963bee7ab1615979e2102ad3d4f5b38a7d6e84655c1b09b6269e326e622be177`
- Client 构建 revision：`506236e6fd2cfd151a08737f3014387b7c36e3a7bc3ba295781788f2c707deac`

## 安全部署

精确 Desktop cold startup gate **PASS**：[baseline](<../sandbox/.desktop-sidebar-reopen-0218/baseline.json>)从当前真实 profile 克隆组成/依赖图，仅替换候选主包，保留六 fork 和其他插件；独立 DSH_HOME/profile/Session storage/ledger/Electron user-data，Cindy Host disabled。sandbox 用 bundled Node/pnpm 离线安装、忽略安装脚本，不执行新安装脚本。

启动命令 `./sandbox/desktop-startup-start.ps1 -Sandbox ./sandbox/.desktop-sidebar-reopen-0218 -RunId enabled`；[Host 日志](<../sandbox/.desktop-sidebar-reopen-0218/enabled.out.log>)到达 `http://127.0.0.1:39422/`。[实际 app-protocol 启动验收](<../sandbox/.desktop-sidebar-reopen-0218/enabled.acceptance.json>)确认 `dsh-app://app/` preload、所有 Client entry、root/sidebar/Session/Workspace/conversation 核心激活，errors/failures 为空，七个 served bytes 匹配候选。只做 startup；没有操作 collapse/expand，也没有功能/视觉 sandbox QA。

已按 PID/命令和监听所属完整进程树核对，通过 CDP `Browser.close` 关闭，并确认所有 owned processes 及 39422/9228 监听消失。[清理证据](<../sandbox/.desktop-sidebar-reopen-0218/cleanup.acceptance.json>)。之后重新执行[部署前组成/依赖核对](<../releases/0.2.18-desktop-sidebar-reopen/preinstall-consistency.json>)并保存[当前配置与旧主包备份](<../releases/0.2.18-desktop-sidebar-reopen/preinstall-backup/package.json>)。

Plugin Manager 成功安装启用 **0.2.18，restart-required**。[实装验证](<../releases/0.2.18-desktop-sidebar-reopen/installed-verification.json>)确认 wanted/installed lock 一致、7 个 archive/client hashes 和 lock integrity 匹配、其他直接依赖与 bundle选择不变、用户 patch 未改。[完整依赖图验证](<../releases/0.2.18-desktop-sidebar-reopen/dependency-graph-verification.json>)确认 211 packages / 211 snapshots（含新主包）与安全启动沙箱逐项一致。

**已安装，尚待用户重启真实 Desktop 生效并验收收起/重开功能及外观。** 代理未重启真实 Desktop；unit/contract/startup/包检查不代表已经做了真实 collapsed 状态的功能或视觉测量，也不代表当前页面已加载新包。
