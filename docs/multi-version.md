# 多版本支持：同一插件，多条 dsh 线

> English abstract: the six client-UI forks replace app-owned modules, so fork bytes are
> only valid against the exact upstream line they were built from. Supporting a second
> machine on a different dsh runtime therefore means building and releasing a **second
> fork library** for that line — not relaxing a version check. The plugin package itself
> is line-agnostic. `provenance/versions.json` registers the supported lines and every
> build/verify/pack script takes `--version`.

## 0. 结论先行

**插件本体跨线通用，六个 fork 载荷必须逐线构建。** 安装任何一条线 = 插件 tarball + 该线的
六个 fork tarball。不要混线。

| dsh 运行时 | fork 库 | 构建基线与来源 | 状态 |
|---|---|---|---|
| `0.2.2-rc.3` | `releases/0.2.2-rc.3-forks/` | `third_party/source/dsh-v0.2.2-rc.3.tar.gz` | 沙盒门禁通过 |
| `0.2.2-rc.2` | `releases/0.2.2-rc.2-forks/` | `third_party/source/dsh-v0.2.2-rc.2.tar.gz` | 沙盒门禁通过 |
| `0.2.2-rc.1` | `releases/0.2.2-rc.1-forks/` | `third_party/source/dsh-v0.2.2-rc.1.tar.gz` | 已发布 |

插件本体：`releases/veewo-dsh-better-tasks-0.4.0.tgz`，**三条线共用**。
它的 `peerDependencies` 是区间 `>=0.2.0-rc.2 <0.3.0-0`，rc.1/rc.2/rc.3 都在区间内，
所以升级 dsh 线**不需要重打插件包**（只有跨到 0.3.x 才需要再放宽区间）。

## 1. 换线时到底变了什么

fork 是「源码级替换」：profile 根部装着同名包，应用加载我们的 `lib/client.js` 而不是自带的。
这个替换对上游 API 形状是敏感的——上游改了一个函数的签名，我们编译出来的字节仍然「能打包、
能加载、bundle 不报错」，但运行时会调到不存在的东西。这正是 `0.2.2-rc.1 → rc.2` 实测到的坑：

| 上游改动 | 我们原先的写法 | 后果 | rc.2 的写法 |
|---|---|---|---|
| `openSessionMenu` / `openWorkspaceMenu` 回调被删除，改为共享工厂 slot | `openSessionMenu(id, title, rect, 'toggle')` | 行尾 `...` 菜单整体失效 | `renderFactorySlot('contextMenu.button', { target, label, className })` |
| `useRemoteAccess` 从 ui-workspace 移除 | `props.useRemoteAccess('session/create')` | 无分区（ungrouped）行报错 | 无分区桶不再提供 New Session，删除该调用 |
| `onCreate` 签名 `()` → `(workspaceId)` | `onCreate()` | 新会话落到错误 Workspace | `onCreate(workspaceId)` |
| `facade.insertQuote(text)` → `(text, summary?)` | 单参调用 | 引用卡片丢失摘要/去重失效 | 透传 `QuoteSummary` |
| `facade.submit(...)` 新增 `allowEmpty` | 无该参数 | 空续写输入被丢弃 | 透传 `allowEmpty` |
| tsdown 预设新增 `minify: { compress:false, mangle:false }` | — | 产物体积下降 ~30%（正常） | 无需改动（保留标识符） |

**关键教训**：`tsdown` 打包不做类型检查，`npx tsdown` 对上述全部错误都是**静默通过**。
所以换线后必须验字节，不能只看构建成功。

## 2. 注册一条新线

`provenance/versions.json` 是唯一登记处：

```jsonc
"0.2.2-rc.3": {
  "tag": "dsh-v0.2.2-rc.3",
  "commit": "<tag sha，gh api repos/.../git/ref/tags/dsh-v0.2.2-rc.3>",
  "tarball": "https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/dsh-v0.2.2-rc.3",
  "tarballSha256": "<sha256>",
  "vendoredTarball": "third_party/source/dsh-v0.2.2-rc.3.tar.gz",
  "status": "supported",
  "forkLibrary": "better-tasks-forks-0.2.2-rc.3",
  "overlayVariant": "default"
}
```

`provenance/source.lock.json` 仍是**默认激活线**的清单，不注册新线时所有旧命令行为不变。

## 3. 一条命令的构建流程

```powershell
$ver = '0.2.2-rc.2'

# 1) 抓源码（GitHub API 有速率限制，用 gh 认证）
gh api repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v$ver --jq '.object.sha'
curl.exe -sS -L --max-time 300 -o "third_party/source/dsh-v$ver.tar.gz" `
  "https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/dsh-v$ver"
# 校验：tar -tzf 能完整列出；条目数应与邻近版本同量级（rc.2 实测 23,924 条）

# 2) 契约漂移 —— 先看这个
npm run check:contract -- --from-tag 0.2.2-rc.1 --to-tag $ver

# 3) 官方基线字节（externals 校验用；缺了构建会直接报 ENOENT）
#    逐个 npm pack "@deepseek-ai/dsh-client-<slug>@$ver" 解包到 third_party/<slug>/<ver>/package/

# 4) 构建
node scripts/build-forks-from-source.mjs --build --version $ver

# 5) 验字节（见 §4，必做）

# 6) 打包
./scripts/pack-forks.ps1 -Version $ver

# 7) 沙盒冷启动门禁（§5），通过后才允许真机安装
```

### 3.1 a 层按线分叉（仅当接管模块真的被上游改写）

默认 `src-overlay/<slug>/` 是扁平的一棵树，`overlayVariant: "default"` 表示所有线共用。
当某个接管模块必须**逐线不同**时，把该线的版本放进 `src-overlay/<slug>/<variant>/`，
并在 registry 里把这条线的 `overlayVariant` 指过去：

```
src-overlay/ui-workspace/client/rows/Rows.tsx              # 默认（rc.1 形状）
src-overlay/ui-workspace/0.2.2-rc.2/client/rows/Rows.tsx   # rc.2 形状
```

`--variant <name>` 可临时覆盖。变体目录存在时整棵按变体取，**不做文件级合并**（避免半新半旧的叠加态）。
校验时 `check-upstream-contract.mjs` 也认这个规则：变体目录是 `client/` 的兄弟目录，
扫扁平树时会被排除，不会冒充 `src/<variant>/...` 源文件。

> 本轮实测：`0.2.2-rc.1 → rc.2` 需要分叉的只有 3 个接管文件
> （`ui-workspace/rows/Rows.tsx`、`ui-workspace/rows/WorkspaceBrowser.tsx`、
> `ui-conversation/input/facade.ts`）。分叉时复制整棵 overlay 到变体目录：
>
> ```powershell
> Copy-Item "src-overlay\ui-workspace\*" "src-overlay\ui-workspace\0.2.2-rc.2\" -Recurse -Force
> ```

### 3.2 补丁的回退规则

`src-patches/<slug>/<version>-better-tasks.patch` 优先。这条线没有自己的补丁时，回退到
**严格早于该线的最新一条**补丁（本仓库上游改动以新增为主，`0.2.2-rc.1` 的补丁干净应用到了 rc.2）。
**绝不会用比目标线更新的补丁**——那是写给另一份源码的。

回退不是盲目的：整文件替换型 hunk 会核对行数，行数对不上直接报错。

> **rc.2 → rc.3 的实测**：rc.3 在 `ui-workspace/client/index.ts` 的 import 行插入了
> `type DirectoryFlowSlotName`，共享补丁的 hunk 1 因此失配。处理方式是**复制一份**
> `0.2.2-rc.3-better-tasks.patch` 只改那两处 hunk 的行号与内容，共享补丁保持不动。
> 直接改共享补丁会立刻弄坏 rc.2（本次已发生并回退）——这是「只早于、不晚于」规则存在的原因。

## 4. 验字节（换线必做，别只看构建成功）

```powershell
cd .srcbuild\packages\client\<slug>
npx tsdown --config tsdown.build.ts

# 该线已删除的 API 在产物里必须为 0 次
Select-String -Path lib\client.js -Pattern 'openSessionMenu|openWorkspaceMenu|useRemoteAccess' -AllMatches

# 该线新增的能力必须真的出现
Select-String -Path lib\client.js -Pattern 'contextMenu\.button'
```

再跑全量回归与契约自检：

```powershell
node --test                                                        # 450 项
node scripts/check-upstream-contract.mjs --from-tag $ver --to-tag $ver --version $ver   # 期望 39/39 unchanged
```

`--from-tag == --to-tag` 是**自洽检查**：列出 a 层 import 的 39 个上游模块是否全部在新线上存在且字节一致，
10 个整模块接管的接缝是否仍然成立。全部 `ok` 才说明 a 层真的挂上去了。
`--version` 让检查器读该线的 overlay 变体；不加则读默认线。

再加一条**跨线回归**：改完一条线后，另一条线必须仍能构建出原来的字节。
`ui-layout` 等不涉及分叉的包应逐字节复现 `releases/<ver>-forks/candidates.json` 里记录的 `clientSha256`
（`BUILD_REVISION` 会随源码哈希变化，只差这一行是正常的）。

## 5. 沙盒门禁（真机安装前的强制步骤）

```powershell
node scripts/prepare-layer-split-sandbox.mjs `
  "sandbox/.desktop-rc2-gate" "releases/0.2.2-rc.2-forks" 39433
# 安装沙盒 profile 依赖（pnpm 用 runtime 自带的 11.28.5）
./scripts/layer-split-startup-gate.ps1 -Sandbox "sandbox\.desktop-rc2-gate" -SettleSeconds 60
```

每个沙盒有自己的 `DSH_HOME`、profile、Session 存储、Electron user-data 和端口，
`dsh-cindy-host` 一律 `disabled: true`，`webserver` 绑定 `127.0.0.1`。

判据（全绿才算过）：`result: PASS`、`bootMarker: true`、`manifestOk: true`、
`missing: []`、`fatalStderr: []`、`cleanupPidsRemaining: []`。

> 沙盒前先确认 profile 根部的 `@deepseek-ai` 只有六个 fork（+ `schemastery`）。
> `publicHoistPattern` 写错（例如重复 `ui-` 前缀）不会报错，但六个 fork 不会 hoist，
> 应用会静默回落到自带模块——表现是「装了插件但界面没变」。

## 6. 真机安装（另一台 rc.2 机器）

**前置**：那台机器的 `dsh` 必须是 `0.2.2-rc.2`。用错线的 fork 会启动失败或界面错位。

```powershell
# 1) 取安装物（两个压缩包 + 六个 fork tarball 一起拷过去）
#    releases/veewo-dsh-better-tasks-0.4.0.tgz
#    releases/0.2.2-rc.2-forks/*.tgz

# 2) 完全退出 Desktop（含托盘）

# 3) 先写 profile 的 linker 策略
#    <DSH_HOME>/profiles/desktop/pnpm-workspace.yaml
```

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

```powershell
# 4) 七个 tarball 一起装
$specs = @(Get-ChildItem '.\0.2.2-rc.2-forks\*.tgz').FullName + (Resolve-Path '.\veewo-dsh-better-tasks-0.4.0.tgz').Path
dsh plugin --profile desktop add @specs

# 5) 重启后验收（纯 CLI 结果不可信）
./scripts/desktop-probe.ps1 -SourceProfile desktop
# 期望 desktop probe: PASS，六个 fork 全部出现在 boot manifest
```

**只装插件本体不装六个 fork** 会得到一个「半个安装」：能启动、probe 也可能 PASS，
但左侧栏整列消失。这是最容易被误判为「插件坏了」的状态。

## 7. 已知坑（换线时踩过的）

| 症状 | 原因 | 处理 |
|---|---|---|
| 构建成功但行尾菜单失效 / 控制台报 `openSessionMenu is not a function` | 上游删了回调，bundle 不做类型检查 | 按 §4 验字节，改用 `renderFactorySlot('contextMenu.button')` |
| `ENOENT ... third_party/<slug>/<ver>/package/lib/client.js` | 缺该线官方基线字节 | `npm pack` 该线包并解包到 `package/` |
| 装了插件但界面没变 | `publicHoistPattern` 名字写错或 linker 不是 `isolated` | 按 §6 检查，profile 根部应只有六个 fork |
| fork 产物比上一线小 ~30% | rc.2 预设加了 `minify`（保留标识符） | 正常；用 §4 确认我们的标识符还在 |
| 补丁报 "changed shape on this line" | 整文件替换型 hunk 行数对不上 | `--emit-patch <slug>` 重新导出该线补丁 |
| `dsh: installation rejected: ... incompatible with dsh` | peer 区间不覆盖该线 | 放宽插件 `peerDependencies` 后重打包 |

## 8. 文件地图（相对本文档新增/变更）

| 路径 | 作用 |
|---|---|
| `provenance/versions.json` | **支持线登记处**（tag / commit / sha256 / variant） |
| `scripts/fork-versions.mjs` | 版本解析：`--version` → `DSH_FORK_VERSION` → `source.lock.json` |
| `scripts/build-forks-from-source.mjs` | 支持 `--version` / `--variant`；补丁按线优先、按序回退 |
| `scripts/check-upstream-contract.mjs` | 支持 `--version`；扫 overlay 时排除变体兄弟目录 |
| `scripts/prepare-layer-split-sandbox.mjs` | 支持 `<sandbox> <release> <port>` |
| `scripts/layer-split-startup-gate.ps1` | 从 `baseline.json` 读端口 |
| `src-overlay/<slug>/<variant>/**` | 逐线分叉的 a 层（本仓库：`ui-workspace`、`ui-conversation` 的 `0.2.2-rc.2`；rc.3 复用） |
| `src-patches/<slug>/<version>-better-tasks.patch` | 逐线补丁（本仓库：`0.2.2-rc.1` 共享、`0.2.2-rc.3` 独立） |
| `third_party/source/dsh-v0.2.2-rc.2.tar.gz` | rc.2 vendored 源码（sha256 已校验） |
| `third_party/<slug>/0.2.2-rc.2/package/` | rc.2 官方基线字节 |
| `forks-0.2.2-rc.2/<slug>/lib/client.js` | rc.2 构建产物 |
| `releases/0.2.2-rc.2-forks/` | rc.2 可安装 tarball + `candidates.json` |
