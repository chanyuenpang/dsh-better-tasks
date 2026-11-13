# rc.2 斜杠提交 reading catch：定位与最小修复

## 实包结论

2026-11-13 直接读取 Desktop asar 内 `@deepseek-ai/dsh-api-session-controller@0.2.2-rc.2` 的源码，而非凭版本记忆：

- [sessions 接口](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/api/session-controller/src/client/contract/sessions.ts#L101-L106>)明确返回 `Promise<void>`。
- [service](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/api/session-controller/src/client/sessions/service.ts#L360-L365>)直接返回 manager 的结果。
- [manager](<https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/packages/api/session-controller/src/client/sessions/manager.ts#L340-L389>)三种返回都是 Promise：已有 inflight.promise；ready 时 Promise.resolve()；新读的 async operation。异步内部 return 不会让外层方法返回 undefined。

所以 [Better Tasks 的 pinned session projections effect](<../src/client.js#L2142-L2156>)不是已证实的根因，不对该后台静默刷新做猜测式修改。

本机磁盘上的 Better Tasks 实际版本为 `0.4.1-local.20261113.2`，不是报障描述的旧 `0.4.0`。它是此前按 rc.2 精确组合重建、隔离启动并安装的候选；仓库基础 package 版本与本地安装候选版本不能混为一谈。未用磁盘版本冒充当前页面加载版本或用户验收证据。

## 已复现的错误

真实已安装的 `dsh-client-ui-conversation` 产物中，主输入框斜杠提交会执行：

```js
trackOperation(() => this.adjudicate(attempt, draft))
// adjudicate 启动 .then 回调，但不 return；它的返回值是 undefined。
// 主输入框没有 detached-surface 的 withOperation 包装时：
operation().catch(...)
```

直接抽取安装产物中的两个原方法，在隔离的内存对象上执行，稳定得到：

```text
Cannot read properties of undefined (reading 'catch')
```

随后 resolve 仲裁 Promise，`adjudicated` 事件仍会产生。这与技能注入成功但同时出现错误 toast 一致；不依赖重扫宿主日志，也不归因于 claw-kit。它证明该输入分支存在同文案缺陷，但没有伪称捕获到了当时浏览器的历史调用栈。

修复仅在 [rc.2 conversation overlay](<../src-overlay/ui-conversation/0.2.2-rc.2/client/input/facade.ts#L793-L813>)：将 adjudicate 的返回声明改为 Promise<void>、无 pipeline 分支返回 Promise.resolve()、正常分支 return 原仲裁链。保留原成功/失败派发、disposed/attempt 检查和通知逻辑。不是对 void 包一层 Promise.resolve：后者会让 detached surface 在真正仲裁结束前提前结算。其他运行时 overlay、主包、commands、input-trigger、claw-kit 均未修改。

## 主包全部 catch 审计

以下是当前 [主包源码](<../src/client.js>)中的 9 处，行号与旧 0.4.0 描述有偏移：

| 行 | 接收者 | 保证 |
|---|---|---|
| 952 | 输入 surface 创建链 | 以 Promise.resolve().then(...) 起始，包含同步抛错转 rejection |
| 990 | 问答 surface 创建链 | 同上，不直接对 provider 返回值 catch |
| 1123 | Final 快捷读取链 | Promise.resolve().then(...).then(...)；缺内容仍返回 Promise |
| 1295 | Final HTTP 链 | 浏览器 fetch().then(...).then(...) |
| 1372 | moveTaskBefore | 注入到 taskPins.moveBefore；该函数返回 enqueue 的 Promise 链 |
| 1616 | unpinTask | 注入到 taskPins.setPinned；早退、重复请求、正常请求均返回 Promise |
| 1910 | 切换视图设置 | 已经使用 Promise.resolve(...) |
| 2037 | 设置写入 | 已经使用 Promise.resolve(...) |
| 2150 | sessions.refreshProjections | 实际 rc.2 asar 接口、service、manager 三分支均为 Promise |

Pin/拖动包装的依据见 [pin-client](<../src/pin-client.mjs#L136-L176>)；注入接线见 [mountSidebar](<../src/client.js#L2202-L2216>)。不改变现有后台吞错或交互错误处理语义。

## 验证边界

[专门回归](<../test/rc2-slash-adjudication.test.mjs>)执行 rc.2 overlay 的实际两个方法，覆盖主输入框原文斜杠、缺 pipeline、surface 等待仲裁结算、rejection、销毁后的迟到结果和同步 provider 异常。它不冒充完整 Electron 点击验收。验证结果：既有 477 项回归通过；新增测试的字符串拼接装载问题修正后，专项 6/6 通过；最终修复差异与 whitespace 检查通过。

该修复进入 Tasks 0.4.1 / DSH 0.2.2-rc.2 的组合 Release，需要同步更新主包与新构建的 conversation 包；旧 tarball 不会自动更新。精确组合的隔离启动记录随 Release 提供。真实重启和主输入框提交 /knowledge-capture 的功能验收仍由用户进行，不能把源码/离线测试/启动门禁冒充真实点击通过。若安装生效后仍报同文案，必须取得那次 Console 堆栈再定位。
