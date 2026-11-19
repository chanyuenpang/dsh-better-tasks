# 卸载 / 回滚 Better Tasks

## rc.5 / Tasks 0.4.9 回滚

如从 rc.5 退回 rc.3，先停止 Desktop（含托盘），同时恢复官方 rc.3 运行时、升级前 Profile 配置/依赖锁及完整 rc.3 七包。不要把 rc.3 fork 混入 rc.5，也不要删除 Session、ledger、原生 Pin、顺序或设置。若升级曾写入数据，先保留故障副本，再核对升级前备份。若继续用 rc.5 而只卸载 Better Tasks，按下方通用移除流程移除 bundle 与全部六个 fork。

## rc.3 / Tasks 0.4.8 回滚

0.4.8 增加整主会话区引用并保留列表排序，修复宽度恢复与标题字重。回到0.4.7时恢复其完整七包和配置，特别是 Layout、Workspace、Conversation fork；不删除草稿、会话、Pin、持久化任务顺序或原宽度键。旧0.4.7资产不覆盖。

### 0.4.7 历史回滚

0.4.7 发布灰阶标题层级（普通深灰、选中主要文字色），执行代码与已本地安装的 0.4.7-local.2 一致。需要回到 0.4.6 时恢复其完整七包与配置，不删除任务顺序或会话。

0.4.6 新增明确新建任务直接置首并持久化的修复；回到 0.4.5 应恢复对应完整七包及配置，不删除已保存顺序、Session 或原生 Pin。

0.4.5 合并初始化与完整顺序持久化优化；回到 0.4.4 应恢复该版本的完整七包与配置，保留现有 Session、原生 Pin 和存储。旧版不会自动恢复从未落盘的历史显示顺序；不要删除排序域或旧队列来“重置”升级。

[rc.3 候选](<install-rc3.md>)必须整体保留主包与六个 rc.3 fork。安装失败时保持 Desktop 退出，恢复安装前 Profile 配置与同一运行时的完整七包；仅把主包降到 rc.2 的 0.4.1 不是合法回滚。若要退回 rc.2，须先恢复相应官方运行时，再恢复原 rc.2 / Tasks 0.4.1 七包，不能跨线混用。以下移除插件与六个 fork 的通用步骤同样适用；不删除任何 Session/Pin/排序/设置数据。

## Windows Desktop 通用移除与恢复

旧 Release 的 Desktop CLI 卸载和重装命令不适用；`desktop` Profile 由 Electron 管理。沿用[安装手册](<install-desktop.md>)的分工和门禁。先备份、核对目标组合；若确需停机或重启，先完成任务并由用户确认，不直接热替换正在使用的客户端包。

### 恢复官方侧栏

先在隔离环境验证计划恢复的原生组合。运行时允许安全热切换时，从 Desktop 插件管理器禁用或移除 Better Tasks 主 bundle；否则安排停机，不强行触发热切换。完全卸载还须经授权移除六个仅由 Better Tasks 使用的 Profile 根依赖，否则同名模块仍可能解析到 fork。它们不是 bundle，不在插件管理器中逐一移除。对于历史手工加入的替换行，只移除已确认属于 Better Tasks 的行，保留其他插件和用户配置。核对原生模块恢复解析、无残留替换行后再由用户验收。

### 安装失败或切回上一版 Tasks

先保持新 Better Tasks **不启用**；即使安装工具报失败，也要检查实际依赖字节、manifest 和锁文件，不假定已经回滚。用安装前备份、原始归档和同一运行时恢复最后可启动的组合。受控恢复根依赖时，核对实际 Profile 路径，使用对应 Desktop 随附的 pnpm，按备份锁文件重新安装（`install --ignore-scripts --frozen-lockfile --prefer-offline`）；先确认不会覆盖安装后无关的配置变化。不只复制旧锁文件，也不直接覆盖客户端 JS。恢复后复核根依赖、版本、实际客户端哈希和锁的一致性，才能重新启用或启动。若无法恢复，保持已停止的 Desktop 不启动，或让正在运行的 Desktop 继续保持新组合禁用；报告确切状态，不用 `--force`。

回退 Tasks 不等于回退 DSH：同一运行时内恢复与上一版清单不一致的包；跨运行时回退时一起恢复匹配的运行时与七包，不混线。旧版组合 tag 不移动。

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
