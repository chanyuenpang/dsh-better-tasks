# 升级到新的 dsh 版本 — Better Tasks 客户端 UI fork 维护手册

> English abstract: Better Tasks ships **forked builds** of six app-owned client UI modules
> (`ui-layout`, `ui-workspace`, `ui-user-questions`, `ui-input-trigger`, `ui-commands`, `ui-conversation`).
> Every time the DeepSeek Harness desktop runtime moves to a new dsh line, those forks must be rebuilt
> from that line's source tag, re-packed, and re-verified against the **real desktop application** —
> not against the CLI web host. This document is the checklist for that upgrade.

适用对象：`@veewo/dsh-better-tasks` 的维护者。
最近一次实战：`0.2.0-rc.2 → 0.2.1-rc.2`（2026-10-18），耗时约 40 分钟。

---

## 0. 一页清单

```powershell
# 0) 目标版本
$tag = 'dsh-v0.2.2-rc.1'        # 例：未来版本
$ver = '0.2.2-rc.1'

# 1) 抓 tag 源码并 vendor（见 §2）
# 2) 更新 provenance/source.lock.json（tag / version / tarballSha256）
# 3) 检查并适配构建管线（§3）
node scripts/build-forks-from-source.mjs --stage

# 4) 移植 6 个源码补丁（§4）：git apply --reject → 手工解冲突 → --emit-patch
foreach ($s in 'ui-layout','ui-workspace','ui-user-questions','ui-input-trigger','ui-commands','ui-conversation') {
  node scripts/build-forks-from-source.mjs --emit-patch $s
}

# 5) 构建
node scripts/build-forks-from-source.mjs --build

# 6) 打包 fork tarball（§5）
./scripts/pack-forks.ps1 -Version $ver

# 7) 重打包 better-tasks，依赖指向新 tarball（§6）

# 8) 真机验证（§7）—— 必须用真实桌面应用，不要用 CLI
./scripts/desktop-probe.ps1 -SourceProfile <测试 profile>
```

---

## 1. 为什么需要 fork，以及为什么升级时一定会坏

桌面端 shell 的模块解析有一层**拦截层**，位置就是 `<profiles>/node_modules`
（`dsh-app-boot` 的 `computeProfileLayer`：*"The interception layer of a profile is
`<profileParent>/node_modules`: an entry occupies its name there"*）。

所以：

- 把 fork 放到 profile 根部的 `@deepseek-ai/dsh-client-ui-*`，**应用自带的对应行就会加载 fork** —— 这是
  Better Tasks 侧栏/输入区能生效的唯一机制；
- 同一层里**出现任何其它 `@deepseek-ai/dsh-*` 核心包**都是致命的：核心行会加载 profile 里那份，
  而那份自己的 `import '@deepseek-ai/cordis'` 在 profile 里没有解析目标 → 整棵树起不来；
- fork 是**上一代源码编出来的**，而应用每代都在这些模块里加新导出 —— 旧 fork 会让依赖这些导出的
  内置客户端插件直接 `failed`（实测：`ui-skill` / `ui-reference` / `ui-secret-mask` / `ui-goal`）。

结论：**每次 dsh 升代，六个 fork 必须跟着重建**，且必须用真机验证。

---

## 2. 抓取目标版本的源码

上游打的是 `dsh-v<version>` tag。`git fetch` 在本机环境会挂起（smart-HTTP），优先走 codeload：

```powershell
$tag = 'dsh-v0.2.2-rc.1'
curl.exe -sS -L -C - --max-time 300 -o "$env:TEMP/$tag.tar.gz" `
  "https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/$tag"
```

`codeload.github.com` 不可达时（2026-10-18 实测），用公共反代前缀（下载完必须校验大小与内容，
**不要信任反代返回的截断文件**）：

```powershell
curl.exe -sS -L -C - --max-time 300 -o "$env:TEMP/$tag.tar.gz" `
  "https://gh-proxy.com/https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/$tag"
# 一定要做：Content-Length 对比 + tar -tzf 能完整列出 + 条目数量级正确
```

然后：

1. `third_party/source/<tag>.tar.gz`（vendored，构建脚本会校验 sha256）；
2. 更新 `provenance/source.lock.json`：
   ```jsonc
   {
     "tag": "dsh-v0.2.2-rc.1",
     "version": "0.2.2-rc.1",
     "commit": "<桌面端 manifest 的 dshBuildCommit，或已知的 tag sha>",
     "tarball":        "https://codeload.github.com/.../<tag>",
     "tarballSha256":  "<sha256>",
     "vendoredTarball": "third_party/source/<tag>.tar.gz"
   }
   ```
   `version` 决定 `src-patches/<slug>/<version>-better-tasks.patch` 与 `forks-<version>/` 的命名。

3. 各 fork 的官方基线字节也要放进 `third_party/<slug>/<version>/package/`（`lib/client.js` 必须在），
   构建末尾的 `assertForkExternals` 会拿它做对比：
   ```powershell
   npm pack "@deepseek-ai/dsh-client-<slug>@$ver"   # 解包到 third_party/<slug>/<version>/package/
   ```

---

## 3. 构建管线适配（每次升级都要看一眼 `tsdown.client.ts`）

`scripts/build-forks-from-source.mjs` 用**官方未修改的** `packages/client/tsdown.client.ts` 预设，
所以上游一改预设，这个脚本就要跟着改。历史变化：

| 版本 | 变化 | 适配 |
|---|---|---|
| 0.2.0-rc.2 | `clientBundle(name, entries)` | 生成 `tsdown.build.ts` 传包名 |
| 0.2.1-rc.2 | 预设新增 `import '../../scripts/experimental-package-policy.ts'` | `stage()` 补拷该文件 |
| 0.2.1-rc.2 | `clientBundle(packageDir, entries, options)`，自己读 `<dir>/package.json` | 生成配置改用 `import.meta.dirname` |

排查方式：跑 `--stage` 后执行一次 `npx tsdown --config tsdown.build.ts`，报错基本都在提示缺文件或参数形状。

---

## 4. 移植源码补丁

每个 slug 的补丁在 `src-patches/<slug>/<version>-better-tasks.patch`，来源是上一代的补丁
（历史版本归档在 `src-patches/<slug>/archive-<old-version>/`）。

```powershell
# 逐条应用上一代补丁；-C1 放宽上下文，--reject 留下落不上的 hunk
git apply --directory=.srcbuild --reject -C1 --whitespace=nowarn `
  src-patches/<slug>/archive-<old-version>/<old-version>-better-tasks.patch
```

处理 `.rej` 的判断原则：

- **上游已经实现了同样的能力** → 直接丢弃该 hunk（例：0.2.1 的 `ui-input-trigger/types.ts` 已自带 `CommandClaim`）；
- **上游改了签名/结构** → 把意图移植到新结构上（例：`startSession` 第二参从 `beforeOpen` 变成 options，
  改成联合签名保留回调；`runDetached` 已要求 segment，就补传 segment）；
- **上游自己新增了同名声明** → 旧 hunk 的“删除”落空会导致重复声明，删掉多余那处
  （例：`WorkspaceBrowser.tsx` 的 `const now`）；
- 移植完**必须能过 tsc**：`npx tsdown --config tsdown.build.ts` 逐包编译。

全部通过后重新生成补丁并构建：

```powershell
foreach ($s in ...) { node scripts/build-forks-from-source.mjs --emit-patch $s }
node scripts/build-forks-from-source.mjs --build     # 会重新 stage → 应用新补丁 → 编译 → 校验 externals
```

产物：`forks-<version>/<slug>/lib/client.js`。

---

## 5. 打包 fork tarball

```powershell
./scripts/pack-forks.ps1 -Version 0.2.2-rc.1
```

做的事：官方 `<version>` 字节 + fork 的 `lib/client.js` → `npm pack` →
`releases/<version>-forks/deepseek-ai-dsh-client-<slug>-<version>.tgz` + `candidates.json`（含 `archiveSha256` / `clientSha256`）。

---

## 6. 重打包 better-tasks

`package.json` 里六个 `@deepseek-ai/dsh-client-ui-*` 依赖要指向**新版本** tarball，
并把 `peerDependencies` 的 `@deepseek-ai/dsh-session-query` / `dsh-storage-domain` 放宽到覆盖新运行时
（上游是精确版本时必须改，否则 `dsh plugin add` 直接 `installation rejected`）：

```jsonc
"peerDependencies": {
  "@deepseek-ai/dsh-session-query": ">=0.2.0-rc.2 <0.3.0-0",
  "@deepseek-ai/dsh-storage-domain": ">=0.2.0-rc.2 <0.3.0-0"
}
```

重新 `npm pack`，得到 `veewo-dsh-better-tasks-<ver>.tgz`。

---

## 7. 安装与真机验证

profile 侧必须同时满足三件事（`pnpm-workspace.yaml`）：

```yaml
nodeLinker: isolated          # 传递依赖留在 .pnpm，不让核心包落到 profile 根部
autoInstallPeers: false
publicHoistPattern:           # 只允许这六个占根部，核心行才会加载 fork
  - '@deepseek-ai/dsh-client-ui-layout'
  - '@deepseek-ai/dsh-client-ui-workspace'
  - '@deepseek-ai/dsh-client-ui-user-questions'
  - '@deepseek-ai/dsh-client-ui-input-trigger'
  - '@deepseek-ai/dsh-client-ui-commands'
  - '@deepseek-ai/dsh-client-ui-conversation'
overrides:                    # fork 名字全部指向本地 tarball；核心包钉到运行时版本
  '@deepseek-ai/dsh-client-ui-layout': 'file:<...>.tgz'
  # ... 六个 fork + 13 条核心包
```

> 换 linker 或改 hoist 模式后 pnpm 会要求删掉 `node_modules` 重建（非 TTY 下会直接
> `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）：先删 `node_modules` 与 `pnpm-lock.yaml` 再 `dsh plugin --profile <p> install`。

**验证只能用真实桌面应用**。`dsh --profile X --port N` 走的是纯 web host（`dsh-desktop-host/lib/cli.js`），
不安装桌面 shell 的模块路由，会给出假绿 —— 这是 0.2.1 迁移里踩过的最大坑。

```powershell
./scripts/desktop-probe.ps1 -SourceProfile <profile>
```

判据（全绿才算过）：

```
desktop probe: PASS
  boot manifest : served (__DSH_BOOT__ present)
  client plugins: 16 installed, 16 in boot manifest
```

再核对 fork 字节是否就是本次构建：

```powershell
# clientsha256 来自 releases/<version>-forks/candidates.json
Get-FileHash "<profile>\node_modules\@deepseek-ai\dsh-client-ui-layout\lib\client.js" -Algorithm SHA256
```

以及客户端审计（可选，静态检查 require 支持性与阻塞 inject）：

```powershell
node ../dsh-desktop-migration/audit-client-halves.mjs --profile <profile> --html <boot-page.html>
```

---

## 8. 已知的坑（按症状查）

| 症状 | 原因 | 处理 |
|---|---|---|
| `startup failed: 1 required plugin did not activate`；`failed to import: Cannot find package '@deepseek-ai/cordis'` | profile 根部有核心包副本 | 改 `isolated`，确认根部 `@deepseek-ai` 只剩六个 fork（+ 插件自身） |
| `web boot: N entries did not activate`，`ui-skill` / `ui-reference` / `ui-secret-mask` / `ui-goal` failed | fork 是上一代构建，缺新导出 | 按 §4 重建 fork |
| `dsh: installation rejected: ... is incompatible with dsh X` | `peerDependencies` 是精确版本 | 放宽 peer 区间 |
| `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` | 换 linker 需重建 node_modules | 手动删 `node_modules` + lock 后重装 |
| `tsdown: cannot read <dir>/package.json` | `clientBundle` 第一参已是目录 | 生成配置用 `import.meta.dirname` |
| `Cannot find module .../scripts/experimental-package-policy.ts` | 预设新增内部依赖 | `stage()` 补拷 |
| CLI 沙盒 PASS 但真机崩 | CLI 路径不装模块路由 | 只用 `desktop-probe.ps1` |
| 审计 6 条 `dsh-client-ui-sidebar ... not served` | better-tasks 关掉自带侧栏、由 fork 承担整列 | 已知取舍；确认 fork 的 SidebarRoot 正常即可 |

---

## 9. 回滚

- 代码：`git checkout <上一个 tag>`；
- profile：升级前备份 `<profile>` 的 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`，
  回滚时覆盖回去并删 `node_modules`；
- 运行中出问题：把 `<profile>/node_modules` 改名，应用会退回纯 stock 树，先保证可用再排查。

---

## 10. 文件地图

| 路径 | 作用 |
|---|---|
| `provenance/source.lock.json` | 上游 tag / sha256 / 构建工具链（构建管线的唯一输入） |
| `third_party/source/<tag>.tar.gz` | vendored 上游源码 |
| `third_party/<slug>/<version>/package/` | 各 fork 对应的官方基线字节（externals 校验用） |
| `src-patches/<slug>/<version>-better-tasks.patch` | 该版本的源码增量（唯一事实来源） |
| `src-patches/<slug>/archive-<old>/` | 上一代补丁，移植时参考 |
| `forks-<version>/<slug>/lib/client.js` | 构建产物 |
| `releases/<version>-forks/` | 可安装 tarball + `candidates.json` |
| `scripts/build-forks-from-source.mjs` | stage / apply / build / emit-patch 全流程 |
| `scripts/pack-forks.ps1` | 官方字节 + fork 产物 → tarball |
| `scripts/desktop-probe.ps1` | **真机**启动探针（唯一可信的验收手段） |
