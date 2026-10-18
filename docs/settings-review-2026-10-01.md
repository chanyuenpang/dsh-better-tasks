# 任务视图设置审查（2026-10-01）

## 范围与证据

只做 review，不修改产品源码、不构建或安装候选、不重启真实 DSH。工作树已有大量未提交修改，本次未覆盖它们。

当前 checkout 的 8 个设置从 Host schema、客户端 decoder/store 到消费者均有连接。通过 Host Config Inspect 确认当前条目为 `include:better-tasks-ui`，实际配置命名空间为 `better-tasks-ui`，8 个字段全部声明为 volatile。只读核对了 [已安装包](<C:/Users/chany/.dsh/profiles/desktop/node_modules/@veewo/dsh-better-tasks/package.json#L1-L3>)（0.2.12）和 [已安装客户端展开实现](<C:/Users/chany/.dsh/profiles/desktop/node_modules/@veewo/dsh-better-tasks/lib/client.js#L1292-L1420>)；下述展开/存储问题的代码也存在于安装产物中。未声明当前浏览器的所有行为已经交互验证，也未读取或修改用户当前设置值。

## Findings（按优先级）

### P2：Todo 和快速消息栏的手动覆盖没有生命周期结束处理

[状态解析](<../src/client.js#L528-L580>)优先使用 `${sessionId}:todo` / `${sessionId}:input` 的布尔记录，[存储](<../src/client.js#L623-L637>)又使其跨刷新持久化。Goal 换 ID/结束会删除 Goal 覆盖，Final 新 idle 周期会删除 Final 覆盖，但这两条清理路径都不会删除 Todo/input 覆盖；也没有为两者定义自己的周期。

复现：手动折叠 Todo/input，随后同一 Session 换 Goal、完成后进入新 idle 周期，将两个默认值设为 true，结果两者仍然折叠。反向也成立。设置并未写失效，而是旧覆盖无限期遮蔽默认值。与[设置提示](<../src/client.js#L199-L204>)“手动展开或折叠在当前生命周期内保持”不符。

建议：先明确 Todo 和 input 的生命周期边界（新 Todo 集合/任务、输入对应的 idle 周期等），在边界清理相应覆盖，保留同一周期中的手动选择；不要简单地让每次设置更新强制抹掉手动选择。

### P2：展开记录读取没有保护 localStorage 异常

[useStoredExpansion](<../src/client.js#L623-L632>)对 current 和 legacy key 的 `localStorage.getItem()` 没有 try/catch；JSON 解析内部的 catch 无法接住参数读取阶段的异常。[TaskSwimlane 初始化](<../src/client.js#L999-L1001>)直接执行这个 hook，因此浏览器拒绝存储访问时会在 render 阶段抛出，任务视图无法正常初始化，而非降级为默认展开。

复现用模拟存储抛出 SecurityError，实际 hook 同步抛错。其他记录读取和这里的写入已有保护。建议包住整个读取/迁移过程，异常回退为空覆盖 `{}`；不要清除 Host 设置。

### P3：默认展开“各项互相独立”的提示不准确

[快速消息栏计算](<../src/client.js#L1146-L1149>)明确是 `finalExpanded && inputPreference`，而且只在 idle 状态挂载。因此 `defaultInputExpanded=true` 配合 Final 折叠时，输入栏仍不显示；也不能通过输入默认值独立打开 Final。

这是项目既有 Final-gated 输入契约，不应直接作为逻辑 bug 改成互相独立。但[提示](<../src/client.js#L199-L204>)应该注明“快速消息栏仅在空闲卡片的 Final 展开时显示”，而非承诺显示互相独立。

### P3：字号影响范围提示落后于实现

[提示](<../src/client.js#L193-L194>)说“仅影响 Todo、Goal 和 Final 的展开正文”，但字号也传给[问题卡](<../src/client.js#L1387-L1389>)，并被[问题区 CSS](<../src/client.js#L423-L433>)消费。这是已接受的字体接线，不是字号设置无效。建议同步更新中英文提示，包含任务卡问题区。

## 全部设置有效性

Host 的[默认值与 schema](<../src/index.js#L17-L41>)和客户端的[默认值与 decoder](<../src/task-preferences.mjs#L12-L49>)一致；范围和枚举有效。

| 设置 | 默认值 | 消费与结论 |
| --- | --- | --- |
| `detailFontSize` | 13，允许 11–16 整数 | [详情字号](<../src/client.js#L1108-L1112>)与问题卡有效；提示需修正 |
| `defaultTodoExpanded` | false | [Todo 显示](<../src/client.js#L1147>)有效，但旧手动覆盖不随任务生命周期清理 |
| `defaultGoalExpanded` | false | [Goal 显示](<../src/client.js#L1146>)有效；[按 Goal ID 清理](<../src/client.js#L552-L580>)正确，未知投影不误当结束 |
| `defaultFinalExpanded` | true | [Final 显示](<../src/client.js#L1148>)有效，只适用于 idle；新周期删除 Final 覆盖后回归默认，并非无条件自动展开 |
| `defaultInputExpanded` | false | [输入显示](<../src/client.js#L1149>)有消费者，但依赖 idle/Final，且旧覆盖未清理 |
| `columnLayout` | auto | [列数计算](<../src/client.js#L1576>)有效，auto 严格大于 528px 才双列；single/double 显式覆盖 |
| `titleEmphasis` | project | [属性](<../src/client.js#L1121>)与[样式](<../src/client.js#L370-L375>)有效 |
| `sidebarView` | native | [视图读取/写入](<../src/client.js#L1558-L1565>)有效，在侧栏切换，不是设置页漏掉的死字段 |

“修改立即生效”只对没有手动覆盖的展开项成立；同一生命周期手动选择优先本来就是当前设计，不能把这一点本身当成写入失败。

## 验证与限制

执行已有设置/展开/字体相关单元和 contract 测试，共 **45/45 通过**：

```powershell
node --test test/task-preferences.test.mjs test/desktop-preferences.test.mjs test/task-settings-host.test.mjs test/final-expansion.test.mjs test/task-client-contract.test.mjs test/task-detail-typography.test.mjs
node sandbox/settings-review-repro.mjs
```

[复现脚本](<../sandbox/settings-review-repro.mjs>)只在 Node 中运行纯函数、真实 hook 和模拟 React/设置 scope，不启动或操作真实页面。确认上述两个 P2 边界。另验证了写失败时 Host 恢复值先发布、后拒绝 Promise 的顺序：store 回滚与组件 effect 最终显示最新 Host 值，排除了“失败后永久显示旧 draft”的怀疑。脚本开发时曾断言此怀疑会出现，断言失败后检查 hook/effect 同步路径并改为验证正确行为；最终脚本通过。

额外风险未列为确认缺陷：[Final 周期](<../src/client.js#L1035-L1042>)以 Session `updatedAt` 而不是稳定的回合/Final 标识判断。若元数据更新也改变它，可能过早忘掉手动折叠。本轮未追踪原生 Host 的所有更新来源，因此不声称“改名必定重新展开”。

现有测试主要覆盖 schema/store/纯函数和源码 contract，不覆盖 Todo/input 生命周期失效、存储访问异常；测试通过不能证明这些边界正确。没有安装、热重载、sandbox 启动或真实重启，因此不需要也没有触发启动安全 gate；任何后续修复部署仍须完整遵守该 gate。
