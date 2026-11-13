# 侧栏排版与 DSH 适配规范

范围：Better Tasks 的导航外壳；不重设计任务卡、原生 Session Pin、任务排序或插件页面。当前接点基线为 DSH `0.2.2-rc.2`，**不据此宣称未来版本已兼容**。

## 1. 固定层级

从上到下：品牌/收起控制 → 原生样式新会话 → 紧凑全局入口栏 → 会话/任务切换与内容 → 官方页脚/设置。主内容保持 `flex:1; min-height:0`；原生会话容器采用列布局横向撑满。宽度与展开状态仍由 DSH Layout 唯一管理，不另存第二个宽度。

新会话保留原生图标、elevated 填充、边框与圆角、label-mask/content/shortcut 结构、权限和快捷键提示，继续调用 Workspace 的共享动作。不能换回品牌色大按钮、Unicode 加号或另造会话创建流程。

## 2. 三层样式事实

| 层 | 唯一来源 | 维护方式 |
|---|---|---|
| 本地数字 | [SIDEBAR_LAYOUT](<../src/client.js>) | JS 参数与局部 CSS 变量从同一对象生成，不在按钮旁各写一套尺寸 |
| 语义样式 | DSH 的 `--dsw-*` tokens | 背景、文字、边框、圆角、焦点与 macOS glass 沿用原生语义，不复制当前主题颜色值 |
| 版本合同 | 本页接点表、目标 tag 源码与[升级流程](<upgrading-dsh-version.md>) | 升级只复核发生变化的接口与原生样式，不按版本号复制整页 UI |

当前数字如下；运行时以 SIDEBAR_LAYOUT 为准，调整时先改数字源，再同步本表，不在各组件另写覆盖值：

| 项 | 基线 |
|---|---:|
| 原生新会话高度 / 字号 / 行高 | 38 / 14 / 22 px |
| 展开导航点击盒 / 窄 rail 点击盒 | 34 / 36 px |
| 常规导航图标 / 取消固定点击盒 | 18 / 18 px |
| 入口间距 / 展开栏最大行数 | 4 px / 2 行 |
| Tooltip 延时 | 500 ms |

38/14/22 来自 rc.2 原生新会话；平台标题栏的 28px 控制、14/16px 原生图标等特例服从对应上游合同，不强行套常规入口规格。新功能应优先使用现有角色，不随意增加字号、圆角或硬编码像素例外。

任务卡默认以任务名为主（现有 task 强调模式的主字号/字重/主色），项目名为次；Host 和客户端默认均为 task。缺少该字段的旧配置使用新默认，明确保存过 project 的用户选择不覆盖；设置仍可切换两种强调方式。

## 3. 更多按钮与窄宽度

入口按活动注册表的 order、同序注册顺序显示，不写“插件/自动化任务”的按钮白名单。每个入口使用注册的官方图标、名称 Tooltip、可访问名称与选中态；插件提供新入口时无需编辑侧栏数组。

展开栏横向换行，超过两行后**导航区独立纵向滚动**。窄 rail 最多占侧栏高度的 30%，同样保留滚动。Windows 零宽收起仍沿用原生标题栏展开路径。所有入口和末尾“更多”保留在 DOM/键盘顺序中；不因空间不足删除按钮、自动取消固定或把溢出项假冒成未固定项。Tooltip/Menu 使用 portal，不被导航滚动裁剪。

“更多”保留官方菜单行；原生 rc.2 菜单只列未固定入口，所以固定项旁必须保留 hover/focus 可达的取消固定图标。取消固定前先把焦点交给“更多”，防止被移除的按钮吞掉焦点。Plugins 固定项遵循官方不可取消固定规则。

## 4. 状态边界与失败语义

- 注册表拥有入口 id/order/label/icon；Layout 拥有当前主面板和宽度；Workspace 拥有新会话动作。
- 唯一替代 sidebar shell 拥有短生命周期的入口 unpinned 集合，行为与上游一致；不新增 Host、Config 或 localStorage 持久化。它与 Session Pin、Host 任务顺序完全独立。
- 官方 entry-customization 拥有菜单行；shell 只提供 anchor、开关及回调。菜单打开某入口不等于重新固定。
- actions provider 消失：显示全部注册入口，撤掉“更多”和取消固定；保留内存选择，provider 返回后恢复。不能隐藏后让入口永久不可达。
- 插件卸载/重挂：旧 id 的选择保留；动作拒绝已经卸载的 id。无快捷键条目时只省略提示，不编造快捷键。
- 旧 renderer 无 factory 时只能使用已核实的旧图标 slot 合同。`registerFactory` 存在只是结构探测，不是新 DSH named factory/授权/props 兼容证明；未知关键合同须标记适配未通过，不能吞错后宣称成功。

## 5. 每个新 DSH 版本必须复核的接点

| 接点 | 合同 |
|---|---|
| `sidebar.panel.icon` factory | `{id,size,active}`；factory 独占 `sidebar.panellist` 子座位，root 不重复声明 |
| `sidebar.panellist.actions` | root 拥有 list；传 `entries/onOpen/onPinnedChange/onDismiss`；entry 含 `id/label/pinned/active` |
| 官方菜单 | 核实未固定项过滤、pin/open/dismiss、插件发现/创建动作和图标 factory；不要自绘另一份菜单数据 |
| 新会话 | `session/create` 权限、`session.new` 快捷键、Workspace `startSession`、原生 DOM/CSS tokens |
| Primitives | Tooltip、Menu、ShortcutKeys、原生新会话/更多/Pin 图标、焦点转移方法 |
| Renderer | entry/factory 子座位授权与销毁后的 stale 检查 |

核对目标 tag 的 ui-sidebar、ui-entry-customization、ui-renderer 和 ui-primitives。动态接口改名、owner/props/权限/动作变化属于适配工作；只改外观数字不能掩盖合同漂移。

## 6. 最小验证与交付

[导航回归](<../test/sidebar-navigation.test.mjs>)覆盖动态入口、provider 失去/恢复、取消固定焦点、权限和数字源；[原生离线合同](<../test/sidebar-native-menu-contract.test.mjs>)执行固定版本的真实菜单与 renderer 授权片段；[fixture 来源](<../test/fixtures/sidebar-rc2/provenance.json>)记录目标与摘要。Primitives 在离线测试中是传输替身，**不是完整浏览器或外观验收**。

[升级检查器](<../scripts/check-upstream-contract.mjs>)包含带引号 child key 的回归；其 `attachable` 只覆盖所声明的扫描范围，不能代替上表的 named factory、菜单 props、token 人工复核。适配新线时按目标源码更新/复核 fixture，并记录结果，不能沿用 rc.2 绿色结果冒充新线通过。

全部约定改动完成后统一构建、语法、必要单元/合同回归。安装另须同一精确组合隔离冷启动，仅确认监听与核心激活/启动错误，禁 Cindy，并清理所有沙盒进程。功能与外观由用户验收；不自动做 CSS/几何/像素测量、截图或真机重启。

相邻但独立的任务顺序规则：Host 顺序补充元数据保留任务加入时间，并用原生 listEvents 的首次工作事件元数据补正预先准备的空白会话；不是只看 Header.createdAt，也不是最后活动时间。客户端在已 Pin 空白会话首次变为非空时刷新顺序，即使 Pin 成员没有变化。首次工作时间正值持久化缓存，后续消息不刷新；继承父日志的 fork 继续使用自身 Header 创建时间。手动顺序记录手动应用时间，较晚的显式拖拽优先于迟到的出生元数据；入口排版不读写这些状态。
