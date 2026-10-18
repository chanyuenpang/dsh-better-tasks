# 安装 Better Tasks（任何 dsh 版本线）

这份文档是**唯一权威的安装入口**。npm 上的 `@veewo/dsh-better-tasks` 仍存在，但它不是完整安装路径：
插件要工作必须配合同一 dsh 线构建的六个 fork 载荷，而那些载荷只能从本仓库的 release 资产或
`releases/<dsh-version>-forks/` 取。跨版本安装请照本页，不要只装 npm 包。

## 0. 版本矩阵（先确认自己的 dsh 线）

| dsh 运行时 | fork 库（release tag） | 插件版本 | 形态 |
|---|---|---|---|
| `0.2.1-rc.2` | `better-tasks-forks-0.2.1-rc.2-r1` | `0.3.2` | 插件 + 六个 fork 载荷，两步 |
| `0.2.0-rc.2` | `better-tasks-forks-0.2.0-rc.2-r1` | `0.3.1` | 插件自带 fork 载荷，一步 |

**不要混线**：0.3.1 在 0.2.1 上会被 peer 门禁拒装；0.3.2 配 0.2.0 的 fork 会因客户端模块不兼容而
让 `ui-skill` / `ui-reference` / `ui-secret-mask` / `ui-goal` 启动失败。

## 1. 取安装物

两种来源，字节相同（`releases/<ver>-forks/candidates.json` 里有 `archiveSha256` 可对拍）：

```powershell
# A) GitHub release 资产（推荐）
$tag = 'better-tasks-forks-0.2.1-rc.2-r1'
$base = "https://github.com/chanyuenpang/dsh-better-tasks/releases/download/$tag"
gh release download $tag --dir $forkDir --pattern '*.tgz'

# 插件本体
gh release download v0.3.2 --dir $pkgDir --pattern 'veewo-dsh-better-tasks-0.3.2.tgz'

# B) 仓库内（clone 后）
#   releases/0.2.1-rc.2-forks/*.tgz          六个 fork
#   插件本体：本次发布资产（releases/<ver>/ 不入库）
```

## 2. 安装（tarball，不走 npm）

```powershell
$forks = 'layout','workspace','user-questions','input-trigger','commands','conversation'
$specs = $forks | ForEach-Object { Join-Path $forkDir "deepseek-ai-dsh-client-ui-$_-0.2.1-rc.2.tgz" }
$specs += Join-Path $pkgDir 'veewo-dsh-better-tasks-0.3.2.tgz'

dsh plugin --profile desktop add @specs
```

也可在 Desktop **设置 → 插件**里依次安装这 7 个 tarball，效果相同。

## 3. profile 配置（必需）

`~/.dsh/profiles/desktop/pnpm-workspace.yaml` 必须让六个 fork 落到 profile 根部：

```yaml
packages:
  - .

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

原因（0.2.1 实测）：`ui-layout` 等行按原生包名解析，只有这六个名字出现在 profile 根部，应用才会
加载 fork 而不是自带模块；同时 `nodeLinker: hoisted` 会让 client-modules 丢掉本插件自己的客户端
半边（表现为插件装了但界面没变）。**linker 布局属于验收的一部分，不是个人偏好。**

改完先删旧的 `node_modules` 与 `pnpm-lock.yaml` 再装（换 linker 时 pnpm 非 TTY 会拒绝自动重建）：

```powershell
Remove-Item "$env:DSH_PROFILE_DIR\node_modules" -Recurse -Force
Remove-Item "$env:DSH_PROFILE_DIR\pnpm-lock.yaml" -Force
dsh plugin --profile desktop install
```

## 4. 验收（必须做）

完全退出 Desktop（含托盘）再启动，然后跑真机探针——纯 CLI web host 的结果不可信：

```powershell
./scripts/desktop-probe.ps1 -SourceProfile desktop
```

期望：

```
desktop probe: PASS
  boot manifest : served (__DSH_BOOT__ present)
  client plugins: N installed, N in boot manifest     # 最小 profile 为 7/7
```

可选再跑客户端审计（检查阻塞 inject 与 require 支持性）：`dsh-desktop-migration/audit-client-halves.mjs`。

## 5. 升级到新的 dsh 线

先读 [upgrading-dsh-version.md](<upgrading-dsh-version.md>)：抓上游 tag 源码 → 更新
`provenance/source.lock.json` → 移植 `src-patches/<slug>/<ver>-better-tasks.patch` → 重建 → 打包 →
按本页安装 → 真机验收。**每次 dsh 升代都必须重建六个 fork**，否则升级后 UI 会静默错位。

## 6. 回滚

1. 完全退出 Desktop；
2. `dsh plugin --profile desktop remove @veewo/dsh-better-tasks`（连带移除六行 patch）并移除六个
   `@deepseek-ai/dsh-client-ui-*` 依赖；
3. 或直接还原安装前的 profile 备份（`package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`）并删
   `node_modules`。

## 7. 故障对照

| 症状 | 原因 | 处理 |
|---|---|---|
| `installation rejected ... incompatible with dsh` | 插件与 dsh 线不匹配 | 换矩阵里对应版本 |
| `web boot: N entries did not activate` + `pending (waiting for service: layout / uiConversation)` | 六个 fork 未安装，或没 hoist 到 profile 根部 | 检查 §2 与 §3 |
| 插件装了但界面完全没变、probe 报 `1 installed / 0 in boot manifest` | linker 是 `hoisted` | 改 `isolated` + `publicHoistPattern` |
| `failed to import: Cannot find package '@deepseek-ai/cordis'` | profile 根部混入了其它 `@deepseek-ai/dsh-*` 核心包副本 | 清掉这些目录，别把核心包装进 profile |
| fork 装了、probe PASS，但侧栏还是官方样式 | 未完全重启，或 patch 行被别的补丁覆盖 | 重启；检查 `cordis.patch.yml` 里的 `disabled: true` 六行 |
| 只装了 npm 包（没装六个 fork）：能启动、probe 也可能 PASS，但**左侧栏整列消失** | 六个插入行回落到应用自带模块，而 `ui-sidebar` 已被 patch 禁用、没有 fork 补位（实测 boot manifest 里 `dsh-client-ui-sidebar` 缺失、`layout`/`conversation`/`workspace` 都是自带模块） | 这是"半个安装"，必须补装六个 fork |

## 8. 为什么 npm 不是安装入口

插件本体可以走 npm，但 fork 载荷无法以原作者身份发布到 `@deepseek-ai` scope，而 0.2.1 的
client-modules 又不接受嵌套 Loader 树或子路径行名（实测：分别为 21 条 pending、行被判否）。
因此完整安装必然是「插件 + 六个同线 fork 载荷」，以 tarball 分发，并在本页固化；npm 包保留为
便利入口与版本标记，不作为功能完整性的承诺。
