# Better Tasks 插件发布流程

本项目的正式 DSH Profile 必须加载不可变插件包，禁止直接引用开发 checkout。发布时对每种拟交付的包身份与完整组合只做一次“构建 → 打包 → package-mode sandbox”验证，并记录归档哈希和门禁证据；以后安装**同一归档、同一组合**时复用证据，只需核对配置和哈希，不重复构建、测试或冷启动。归档或组合有变化才需要重新通过门禁。安装不等于重启生效。

## 发布物

每个 scoped npm 发布版本准备四个 tgz（本地未 scoped 版本见第 5 节，仅变更的 fork 需重打包）：

- `veewo-dsh-better-tasks-<version>.tgz`（同时发布为 npm public package `@veewo/dsh-better-tasks`）
- `deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz`

三个 fork 保留上游包名和 `0.1.5-rc.2` 基线，确保 Client 注入身份不变；它们的 tgz 内容由本仓库 provenance/patch 校验保证。`manifest.json` 记录每个文件的 SHA-256、大小和源提交。

## 1. 发布前验证

```powershell
npm test
```

发布前只执行一次完整测试；`npm test` 已包含构建、三个 exact-fork provenance replay 和单元/契约测试。`npm run check` 会再构建一次，仅在需要单独语法检查时按需运行，不作为重复必跑步骤。修改 `package.json` 中 Better Tasks 的版本号；不要随意修改 fork 的包名或基线版本。

## 2. 构建不可变包

以下以 `0.2.0` 为例：

```powershell
$release = Join-Path $PWD 'releases\0.2.0'
New-Item -ItemType Directory -Force $release | Out-Null
# 第 1 步的 npm test 已构建，勿再次运行 npm run build
npm pack --pack-destination $release
npm pack .\forks\ui-layout --pack-destination $release
npm pack .\forks\ui-workspace --pack-destination $release
npm pack .\forks\ui-user-questions --pack-destination $release
```

生成后计算 SHA-256 并写入 `manifest.json`。发布目录一旦用于 Profile 安装就不可覆盖；修复必须发布新版本目录。

## 3. package-mode sandbox 门禁

Sandbox 必须使用独立 `DSH_HOME`，并禁用 Cindy Host：

```powershell
$env:DSH_HOME = Join-Path $PWD 'sandbox\dsh-home'
dsh plugin --profile better-tasks-sandbox add `
  "$release\veewo-dsh-better-tasks-0.2.0.tgz" `
  "$release\deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz" `
  "$release\deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz" `
  "$release\deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz"

dsh --profile better-tasks-sandbox `
  --patch "$PWD\sandbox\cordis.packaged.yml" `
  --no-open --port 3081
```

`cordis.packaged.yml` 只能使用包名：

```yaml
- insert:
    - id: ui-layout-dbt
      name: '@deepseek-ai/dsh-client-ui-layout'
    - id: ui-workspace-dbt
      name: '@deepseek-ai/dsh-client-ui-workspace'
    - id: ui-user-questions-dbt
      name: '@deepseek-ai/dsh-client-ui-user-questions'
    - id: better-tasks-sidebar
      name: '@veewo/dsh-better-tasks'
```

启动门禁通过条件：Host 成功监听，root layout、侧栏、Session、Workspace 和对话核心界面能激活，浏览器启动错误为 0。设置页持久化等功能性验证可随后按变更需要进行；结束后必须停止并确认 `:3081` 与浏览器调试端口均无监听。

## 4. 发布到 npm

主包使用 public scope `@veewo/dsh-better-tasks`。确认 npm 身份属于 `veewo` organization、版本尚未存在，然后发布并回读 registry：

```powershell
npm whoami
npm publish "$release\veewo-dsh-better-tasks-0.2.0.tgz" --access public
npm view '@veewo/dsh-better-tasks@0.2.0' name version dist.integrity --json
```

npm 版本不可覆盖；任何内容变化都必须提升版本并重走 sandbox 门禁。三个 exact fork 不发布到不属于本项目的 `@deepseek-ai` scope，它们继续作为本仓库 release assets 安装。

## 5. 更新当前 Web 使用的本地包（与 npm 发布分开执行）

当前正式 Web 的 Client/Host 身份是未 scoped 的 `dsh-better-tasks`，而第 4 步发布的 `@veewo/dsh-better-tasks` 是另一身份；**npm 发布不会更新当前 Web**。发布流程必须明确跟踪本地更新状态：若本次还要交付当前 Web，按以下步骤继续；若仅发布 npm，则记录“本地未升级”，不得宣称已部署。两条版本号独立递增（例如 npm `0.2.2` 与本地 `0.2.9`），不要用已存在的本地版本覆盖归档。

### 5.1 构建不可变的未 scoped 归档

如果此次发布也要交付当前 Web，在**发布准备阶段**从第 1 步已构建的同一源码产出未 scoped 归档，不要为本地安装再跑一次测试/构建。选一个尚未使用的**本地**版本；在项目根目录、同一个 PowerShell 会话中运行，下文沿用 `$localVersion` 与 `$archive`：

```powershell
$localVersion = '<新的本地版本>'  # 如 0.2.9；不要与 npm 版本混为一谈
$release = Join-Path $PWD "releases\$localVersion-unscoped"
if (Test-Path $release) { throw "发布目录已存在，不可覆盖：$release" }
node scripts/build-unscoped-release.mjs $localVersion
$stage = Join-Path $release 'stage'
npm pack $stage --pack-destination $release
$archive = Join-Path $release "dsh-better-tasks-$localVersion.tgz"
Get-FileHash $archive -Algorithm SHA256
```

脚本只创建 stage，**不会自行打 tgz**；`npm pack` 才生成包。检查 stage 的 `package.json` 是 `dsh-better-tasks@$localVersion`，归档内 Client loader ID 是 `dsh-better-tasks` 且仅注册一次，所需 Host/Client 文件齐全。记录归档 SHA-256、大小和源码状态到同版 manifest；归档一经 sandbox 或正式 Profile 使用就不能覆盖，修复须提升本地版本。仅在 exact fork 内容变化时，于同版目录追加经过 provenance replay 的 fork tgz；未变化的 fork 沿用已验证的上一版本归档。

### 5.2 发布阶段验证未 scoped 的 exact 组合（仅一次）

第 3 步的 scoped npm 包与本节未 scoped 包具有不同 Client 身份，不能共享启动门禁。**在发布阶段对拟安装的未 scoped 归档及其完整真实候选组合冷启动一次**；如果同一归档哈希、三份 fork 哈希、插件行、禁用原生行和依赖图已经有完整且成功的门禁记录，直接复用，不要再安装沙盒依赖或重复冷启动。只有归档或组合发生变化才重新验证。

确需验证时，在**独立** `DSH_HOME` 下准备 sandbox Profile（下面的命令只适用于已经完成 exact graph 准备的 `better-tasks-exact`；它不会自动创建或校正其 patch）：以当前真实 Web 的插件行、禁用原生行、三份 fork 归档和依赖图为基线，仅将待更新的主包（及确实变化的 fork）替换为上述候选；保留 `better-tasks-sidebar: dsh-better-tasks`，移除可能残留的 scoped 候选依赖，不允许双重插件身份。Bridge policy/ledger、Session/storage 必须指向 sandbox，`dsh-cindy-host` 必须禁用；绝不能直接复制真实数据或把 sandbox 指回真实 Profile。安装归档后先核对 sandbox `package.json` 与 `cordis.patch.yml` 确实解析到该候选，而非源码 checkout。

```powershell
$env:DSH_HOME = Join-Path $PWD 'sandbox\dsh-home'
dsh plugin --profile better-tasks-exact add "$archive"
dsh --profile better-tasks-exact --no-open --port 3081
```

用独立浏览器打开输出的 URL，确认 root layout、侧栏、Session、Workspace、对话和 Tasks 均能激活且 console/runtime 启动错误为 0；记录命令/profile、监听 URL（不记录 token）、启动与浏览器结果及归档/组合哈希。只做启动检查，不默认扩展成功能或视觉 QA；验证后停止 sandbox Host/浏览器并确认端口和子进程已清理。**任何一项失败，禁止修改或安装真实 Web Profile**。门禁成功后，同一版本/组合的后续本地安装不再运行这一步。

### 5.3 安装到真实 Profile、取得重启确认并回归

核对第 5.2 节已有的成功门禁证据与本次归档/组合完全一致，且 sandbox 全部停止后，**先完成所有安装和配置变更，最后只剩重启**；不得提前申请重启许可再打包、改真实 Profile、更新锁文件或安装。真实 `DSH_HOME` 不能沿用 sandbox 环境变量。通常按用户要求保留可恢复的旧版本；**用户明确说不备份时不创建备份**，但仍须确认已有发布归档、依赖和恢复方法。将候选归档复制到项目目录外的版本化发布库并核对 SHA-256，然后执行（以实际真实 `DSH_HOME` 和版本替换）：

```powershell
$realHome = Join-Path $env:USERPROFILE '.dsh' # 如果真实 DSH_HOME 另有配置，请改为其实际路径
$env:DSH_HOME = $realHome
$releaseRoot = Join-Path $realHome "plugin-releases\dsh-better-tasks\$localVersion-unscoped"
New-Item -ItemType Directory -Force $releaseRoot | Out-Null
Copy-Item $archive $releaseRoot
$installedArchive = Join-Path $releaseRoot "dsh-better-tasks-$localVersion.tgz"
if ((Get-FileHash $archive).Hash -ne (Get-FileHash $installedArchive).Hash) { throw '归档校验失败' }
dsh plugin --profile web add "$installedArchive"
```

若 fork 同时改变，先复制并安装对应 fork 归档；未改变的 fork 保留原依赖和行。确认真实 `web` Profile 中主插件仍为单一 `dsh-better-tasks` 包名行、无开发 checkout 路径，且包依赖指向发布库；不要把同一 Client 身份 live 切到 scoped，也不要编辑 DSH 安装目录或 shipped preset。**只有在真实 Profile 的包、锁、patch、已安装依赖和全部必要校验都完成、只剩启动新进程时，才申请该次真实 `dsh web` 重启许可**；必须取得用户明确同意并遵守正常 grace period。用户未同意则停在“已安装、未重启/未生效”，不得把用户手动重启旧 Profile 当作迁移完成；用户明确自己重启时仅交付已完成 Profile，不由 agent 申请或执行重启。重启后按第 7 节回归，由用户本人完成最终验收；失败时恢复上一组已验证的归档和 patch，再按确认后的重启流程回滚，保留所有 Session/Goal/Todo/Pin 数据。

> 将真实 Web 从未 scoped 身份迁移到 npm scoped 身份是另一项高风险变更，不属于上述常规本地包更新。必须先按相同 exact graph 门禁验证，并优先在 Host 完全停止后切换身份；运行中 live reload 两种身份可能出现重复 locale 注册，只有用户明确要求直接改活动 Profile 且接受此风险时才可按其指令操作。无论哪种路径，所有应完成的配置、安装和校验都必须先于任何 restart 许可申请。

## 6. 验收责任边界

自动测试、exact-fork replay、package-mode sandbox、正式浏览器回归和错误日志检查都是发布安全门禁，只能形成技术验证证据，不能代替产品验收。

最终验收必须由用户本人在真实 DSH 页面中执行并明确确认。Agent 可以提供验收清单、记录证据和修复问题，但不得代替用户宣布“已验收”；只有用户的明确结论才能作为验收结果。

## 7. 正式回归

重启后检查：

1. `:3080` 只有一个 listener，`:3081` 无 listener；
2. composition 中四个 Better Tasks 行均从 Profile package 解析，不含开发 checkout 路径；
3. 设置页显示 Better Tasks Tab；
4. 字号、三个独立默认展开选项和列布局修改后立即生效并跨刷新保存；
5. Goal 默认折叠，展开 Todo 不改变 Goal；
6. Pin/Unpin optimistic 反馈、Host CAS、Final 与 Workspace 功能无回归；
7. 浏览器 console/runtime 错误为 0。

## 8. 回滚

保留上一版本发布目录和 patch 备份。回滚时：

1. 用 `dsh plugin --profile web add <上一版本 tgz...>` 恢复上一组依赖；
2. 恢复上一份 package-name `cordis.patch.yml`；
3. 取得确认后重启 `dsh web`；
4. 不删除 Session、Goal、Todo、Pin queue、project appearance 或 `better-tasks-ui` settings 数据。

不要把 composition 改回开发 checkout 作为普通回滚手段；项目路径只允许用于隔离开发 sandbox。