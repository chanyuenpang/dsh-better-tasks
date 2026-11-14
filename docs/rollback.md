# 卸载 / 回滚 Better Tasks

## rc.3 / Tasks 0.4.4 回滚

[rc.3 候选](<install-rc3.md>)必须整体保留主包与六个 rc.3 fork。安装失败时保持 Desktop 退出，恢复安装前 Profile 配置与同一运行时的完整七包；仅把主包降到 rc.2 的 0.4.1 不是合法回滚。若要退回 rc.2，须先恢复相应官方运行时，再恢复原 rc.2 / Tasks 0.4.1 七包，不能跨线混用。以下移除插件与六个 fork 的通用步骤同样适用；不删除任何 Session/Pin/排序/设置数据。

## 当前公开组合：DSH 0.2.2-rc.2 / Tasks 0.4.1

所有操作先完成正在运行的任务，**手动完全退出 Desktop（含托盘）**，确认旧进程退出，再修改 Profile。不要热替换正在运行的客户端模块。这里不要求删除会话或用户数据。

### 恢复官方侧栏

使用与该 Desktop 同版本的 DSH CLI，先移除插件，再移除六个 fork 根依赖：

```powershell
$names = @('@veewo/dsh-better-tasks')
$names += 'layout','workspace','user-questions','input-trigger','commands','conversation' |
    ForEach-Object { "@deepseek-ai/dsh-client-ui-$_" }
foreach ($name in $names) {
    dsh plugin --profile desktop remove $name
    if ($LASTEXITCODE -ne 0) { throw "移除失败：$name；先恢复安装前备份，不要继续启动" }
}
```

插件 bundle 的可移除 patch 层禁用官方 `ui-layout`、`ui-sidebar`、`ui-workspace`、`ui-user-questions`、`ui-input-trigger`、`ui-commands`、`ui-conversation`，插入六个替换行及 `better-tasks-ui`。移除插件应同时移除该 bundle 层；**六个 fork 依赖也必须移除**，否则原生包名仍可能解析到 fork，而非官方模块。

若以前手工复制过禁用行，只移除属于 Better Tasks 的那部分，保留其他插件配置。核对 Profile 里无残留 Better Tasks bundle/替换行后，再手动启动并验收官方侧栏和主输入框。需要时恢复安装前的 linker 配置；不要为了回滚而覆盖后来无关的插件改动。

本次 conversation 字节与旧版不同；回退需恢复主包及旧 conversation。旧 [0.4.0 七包](<https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/dsh-v0.2.2-rc.2-tasks-v0.4.0>)保持不变。

### 安装失败或切回上一版 Tasks

使用安装前保存在自己机器的配置备份：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.yml`、`cordis.patch.yml`，连同当时完整七包恢复原组合。不要保留“新版 manifest + 旧 lock + 混线 fork”的组合；手动核对实际绝对 Profile 路径后，仅清理其中可重建的 `node_modules`，再运行 `dsh plugin --profile desktop install`。若缺旧包或恢复失败，保持 Desktop 停止并报告错误，不用 `--force` 绕过检查。

旧版组合 tag 不移动，便于按原 DSH 版本重新下载安装。回退 Tasks 不等于回退 DSH：旧包仍须与当前 DSH 完整运行时版本匹配。升级/回退步骤见[固定版本安装说明](<https://github.com/chanyuenpang/dsh-better-tasks/blob/dsh-v0.2.2-rc.2-tasks-v0.4.1/docs/install.md>)。

**不要删除** Session、Workspace、原生 Pin、Goal/Todo、ledger、Tasks 排序、`better-tasks-ui` 设置或浏览器展开状态键。Profile 配置备份也可能含敏感信息，只留本机，勿附到 GitHub issue。

---

以下是历史旧版恢复记录，**不是当前安装/卸载步骤**。

## Historical 0.1.5 Web composition (not the 0.3 install recipe)

The real profile patch is `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml`.

## Restore all shipped UI packages

1. Remove the block between `# BEGIN dsh-better-tasks exact-fork sidebar replacement` and `# END dsh-better-tasks exact-fork sidebar replacement`.
2. Restart `dsh web`.
3. Refresh the Web page with the new token URL.

Removing that block re-enables the shipped `ui-layout`, `ui-sidebar`, `ui-workspace`, and `ui-user-questions` rows and removes exactly these local rows:

- `ui-layout-dbt`
- `better-tasks-sidebar`
- `ui-workspace-dbt`
- `ui-user-questions-dbt`

## Backups

- Before the original sidebar replacement: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-better-tasks`
- Before the Workspace fork: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-ui-workspace-fork`
- Before the layout fork: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-ui-layout-fork`
- Before the final three-fork install: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-better-tasks-final`
- Before switching from development paths to packaged plugins: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-dbt-package-0.2.0`
- Before the abandoned live scoped-identity migration: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-dbt-0.2.1`
- Before the Workspace-only pinned-title rollout: `${DSH_HOME:-$HOME/.dsh}\profiles\web\package.json.before-dbt-pin-emoji` and `pnpm-lock.yaml.before-dbt-pin-emoji`

The real `0.2.1` pinned-title rollout intentionally keeps the stable unscoped `dsh-better-tasks@0.2.0` main package and composition row, and updates only the immutable Workspace fork from the `0.2.1` release directory. Roll it back by installing the Workspace tgz from the `0.2.0` release directory, then perform an approved clean restart. Do not live-switch the main Client package identity between `dsh-better-tasks` and `@veewo/dsh-better-tasks`: the old locale fiber can overlap the new package during live reload.

Rollback does not delete Session, Workspace, Goal, Todo, cost-meter, project-appearance, Host pin-queue data, or the `better-tasks-ui` Host settings namespace. The browser-only keys `dsh-better-tasks.projection-expansion.v1`, `dsh-better-tasks.projection-expansion.v2`, `dsh-better-tasks.goal-auto-open-cycle.v1`, `dsh-better-tasks.final-auto-open-cycle.v1`, `dsh-better-tasks.final-message-cache.v1`, and `dsh-better-tasks.layout.sidebar-width.v1` may remain safely; shipped packages do not consume them.

## Roll back a scoped main-package identity switch

Do **not** restore an unscoped patch while a scoped Better Tasks Client is still running (or vice versa). Preserve the complete previous `profiles/web` directory and its immutable unscoped main tgz as the rollback source; Session, Workspace, Goal, Pin, settings and ledger storage stay outside that Profile and must not be removed.

After an explicitly authorized stop, and only once the old Host and its target child processes have exited, restore the previous Profile directory as a unit (package manifest, lock, workspace patch configuration, client patch and installed dependencies). Moving a pnpm hoisted Profile changes its absolute `node_modules/.modules.yaml` virtual-store path: set `$env:CI = "true"` and the correct `$env:DSH_HOME`, then run `pnpm install --offline --frozen-lockfile` with the restored `profiles/web` as the working directory before starting it. Verify the original `dsh.profile.bundles` order, the unscoped main and three unchanged forks, and the absence of the scoped main. Using `dsh plugin --profile web install` here can reorder the bundle list. If this fails, leave DSH stopped and report the exact recovery status; do not trigger a live identity reload or an unapproved second restart.
