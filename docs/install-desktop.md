# Better Tasks：Windows Desktop 安装手册

**先匹配运行时和七包组合，再按差异安装；最终启用的是完整组合，不要求七包在同一条命令里替换。** 本页是 `main` 上维护的操作手册；若旧 Release 的 `INSTALL.md` 或 `ROLLBACK.md` 与本页冲突，以本页的 Desktop 流程为准。旧 tag 和资产只用于获取原始包、哈希与发行验证记录，不改写。

## 1. 判断需要换哪些包

1. 在 Desktop「关于」确认**正在运行**的完整 DSH 版本；用实际 Profile 目录（Agent 可读 `DSH_PROFILE_DIR`），不要从全局 `dsh`、默认目录或包名猜测。按 [README 的兼容表](<../README.md#按-dsh-版本安装>)选同一运行时的 GitHub Release。
2. 下载同一组合的七个 `.tgz`、`release-manifest.json`、`SHA256SUMS.txt` 和随包验证记录。核对两种版本、包名、归档 SHA-256 及精确冷启动结果。然后对照真实 Profile 根依赖和实际安装的 `lib/client.js` 校验六个 fork 的版本与客户端 SHA-256；同版本号不代表同字节。新装、缺失或来源无法确认的 fork 按不匹配处理。

| 当前状态 | 处理 |
|---|---|
| 同一运行时，六个 fork 都已确认与目标一致 | 只用 Desktop 插件管理器更新主包 `@veewo/dsh-better-tasks`。不用重装六个 fork。 |
| 同一运行时，部分 fork 不匹配 | 只补齐或替换不匹配的 fork；主包如不匹配也更新。其余包原样保留。 |
| 新装，或 Desktop 已升级而 Profile 仍是旧 RC fork | 先按目标版本准备全部缺失／不匹配的包。在七包齐备前不启用 Better Tasks；不要让旧 fork 在新运行时继续接管原生模块。 |
| 当前运行时没有对应的验证组合 | 不安装、不启用；不要仅装 npm 主包、用官方同名 npm 包补 fork，或给旧版插件加版本豁免。 |

**安装入口有两种，不要混用。** Desktop 的 `desktop` Profile 由 Electron 管理；`dsh plugin --profile desktop …` 会报 `managed exclusively by the Electron application`。只有 Better Tasks 主包是 bundle，走 Desktop 插件管理器。六个 fork 是普通 **Profile 根依赖**，不逐个交给插件管理器（可能报 `not-bundle`，而磁盘文件不一定随清单和锁文件一起回滚）。如果用户只想安装，直接推进核验和沙盒；需要改根依赖时，只在写入前确认一次具体范围，不因 CLI 被拒绝就停止准备工作。

## 2. 验证候选和准备回滚

- 保留现用 Profile 的其他插件、bundle 顺序、配置和依赖锁。候选只变更本轮所需包及必要的选择状态。如果发现其他插件不兼容，记录现状，不未经同意修改、禁用或豁免它。准备备份 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.yml`、`cordis.patch.yml`（实际存在的文件）和旧归档；备份只留本机，不复制真实 Session 或凭据进沙盒。
- 使用 `nodeLinker: isolated`、`autoInstallPeers: false` 和下列六条精确的 `publicHoistPattern`。已有配置正确就不改；需要迁移 linker 时须单独评估并用新配置通过门禁。不要覆盖整个工作区设置、hoist 全部 `@deepseek-ai/*` 或关闭包管理器的安全检查。

```yaml
nodeLinker: isolated
autoInstallPeers: false
publicHoistPattern:
  - '@deepseek-ai/dsh-client-ui-layout'
  - '@deepseek-ai/dsh-client-ui-workspace'
  - '@deepseek-ai/dsh-client-ui-user-questions'
  - '@deepseek-ai/dsh-client-ui-input-trigger'
  - '@deepseek-ai/dsh-client-ui-commands'
  - '@deepseek-ai/dsh-client-ui-conversation'
```

- 在同版本 Desktop 上对实际将要部署的七包、插件行和依赖组合做**隔离冷启动**。独立 `DSH_HOME`、Profile、Session/ledger 和 Electron user-data；禁用 `dsh-cindy-host`，仅监听 loopback。确认监听、Desktop renderer 和核心侧栏／Session／Workspace／会话激活、无启动错误、七包实际加载字节匹配。记录结果并验证自建进程及监听均已清理。Release 里的 PASS 不代替现用 Profile 组合的门禁；沙盒失败不改真实 Profile，不做功能或视觉测试。
- 安装前重新核对 Profile、锁文件与无关依赖，发生漂移先复核候选。没有可恢复备份、受控权限或完整门禁就不写入真实 Profile。

## 3. 分阶段安装，核对后启用

1. **如果要换 fork**，取得对真实 Profile 根依赖的明确授权，保持 Better Tasks 不参与加载。若原 bundle 已启用，先确认禁用后的过渡组合也可安全启动；不能安全热切换时，安排用户同意的停机，不要热替换正在使用的 fork。确认与已验证候选一致后再备份并写入；不要手工复制 native disable 行，也不要直接覆盖 `node_modules` 里的单个 JS 文件。
2. 用当前 Desktop 随附的 pnpm，在核对过的真实 Profile 目录安装**仅缺失或不匹配**的本地 fork 归档。已验证的 rc.5 受控方式是用 Node 调用 Desktop 安装目录 `resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs`，运行 `add --ignore-scripts --save-exact --prefer-offline`，参数只传已核对哈希的 fork `.tgz` 绝对路径。保留已有锁文件和无关配置；从长期保留的目录安装，不用临时下载目录作为依赖来源。操作失败或发现无关依赖漂移时停止，不启用，按[回滚说明](<rollback.md>)恢复并核对实际安装字节。
3. **主包单独交给 Desktop 插件管理器**，规格使用对应的本地 Better Tasks `.tgz`。正在组装新的七包组合时先以禁用状态安装（Agent：`install_bundle` 传 `enabled: false`，然后单独启用）；没有禁用安装入口时不要在叉包还没核对前点安装。若只是同运行时更新主包且六个 fork 已确认完整，可以保持原 bundle 选择，不拆除重装余下六包。
4. 复核所有七包的实际包名、版本和客户端哈希、目标归档及锁记录，确认无关依赖、用户配置和 bundle 顺序未被改写。**全部通过后**才启用主包（Agent：`set_bundle`）。区分磁盘安装、已启用、当前页面已激活三种状态：按插件管理器的 `application` 和实时侧栏注册报告；`restart-required` 不等于已经激活。不要擅自结束或重启真实 Desktop；需要重启时由用户手动操作，或另行明确确认并遵守正常重启宽限期。最后由用户验收功能和外观。

## 已验证案例：rc.5 / Tasks 0.4.9

在已运行 rc.5、但磁盘仍有 rc.3 fork 且旧主包已禁用的 Profile 上：先通过现用插件组合的隔离冷启动（87 个客户端组件激活、七包 served 哈希匹配、浏览器无启动错误），再按授权备份并更新六个根依赖，随后通过插件管理器以禁用状态更新主包。七包核对后启用，实时侧栏注册已激活；未自动重启。本案例不表示所有升级都要换六个 fork，也不意味着其他插件可跨版本启用。
