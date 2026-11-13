# 升级到新的 dsh 版本 — forward + 契约漂移检查

> English abstract: the six client UI forks are split into an **a layer** (our own files,
> `src-overlay/<slug>/`) and a **b layer** (pristine upstream source). A dsh upgrade is a
> forward, not a merge: vendor the tag, ask `scripts/check-upstream-contract.mjs` whether the
> a layer still attaches, build, pass the sandbox startup gate, package. A clean line needs no
> code editing at all; a drifting line produces a short, named work list.

适用对象：`@veewo/dsh-better-tasks` 的维护者。

所有升级和修复都在 `main` 开发，不再为 DSH 版本或 Release 创建长期分支；只用不可变组合 tag 标记完成验证的支持版本，见[发布规范](<release.md>)。当前 `0.2.2-rc.2 → rc.3` 的实际影响与待办见 [rc.3 支持评估](<dsh-0.2.2-rc.3-support.md>)；已有旧 rc.3 fork 不等于当前代码已支持。

侧栏导航的数字、原生样式、factory/菜单/权限接点与按钮增长规则，统一按[侧栏排版与适配规范](<sidebar-layout.md>)复核。`check:contract` 的 attachable 不代表 named factory、菜单 props 或语义 token 已覆盖；每条新线必须另核原生合同与离线 fixture。
分层结构、例外清单和判定规则见 [fork-layers](<fork-layers.md>)。
**同时支持多条 dsh 线**（不同机器版本不同）的构建、门禁与安装见 [multi-version](<multi-version.md>)。
最近一次实战：`0.2.2-rc.1 → 0.2.2-rc.2`（上游把行菜单回调换成 `contextMenu.button` 工厂 slot，
三个接管模块重做；流程本身无冲突，详见 multi-version §1）。

---

## 0. 一页清单

```powershell
# 1) 目标版本
$ver = '0.2.2-rc.1'                      # 例：未来版本
$tag = "dsh-v$ver"

# 2) 抓 tag 源码并 vendor（§2）
# 3) 更新 provenance/source.lock.json（tag / version / commit / tarballSha256）

# 4) 契约漂移报告 —— 先看这个，再决定要不要动代码（§3）
npm run check:contract -- --from-tag <上一个版本> --to-tag $ver

# 5) 构建（stage 上游 → 叠加 a 层 → 应用 patch）
node scripts/build-forks-from-source.mjs --build

# 6) 校验产物身份
node scripts/verify-forks-0.2.0.mjs --write

# 7) 打包
./scripts/pack-forks.ps1 -Version $ver

# 8) 沙盒冷启动门禁（§6），通过后才允许真机安装
```

判定：**第 4 步输出 `VERDICT: attachable` 且没有 REVIEW 项时，本轮不需要编辑任何一行代码。**

---

## 1. 为什么不再需要合并补丁

fork 被拆成两层（详见 [fork-layers](<fork-layers.md>)）：

- **b 层**：上游源码，`--stage` 每次重新拷贝，我们从不改写；
- **a 层**：我们自己写的全部内容，落在 `src-overlay/<slug>/`，以及少量必须留在上游文件里的 hunk。

升级时的冲突面只剩第三种：`src-patches/<slug>/*.patch`。当前是 **22 个上游文件 / 77 个 hunk**，
全部是注册级或小声明改动；分层改造前是 48 个文件 / 200 个 hunk，其中在 0.2.1→0.2.2 上
13 个文件真实冲突（38 个冲突 hunk）。

a 层文件与 patch 的分工、以及“为什么这条 hunk 不能改成覆盖”的逐条理由，见
[fork-layers 的例外清单](<fork-layers.md#the-exception-list>)。

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

## 3. 契约漂移报告（新流程的第一步）

```powershell
npm run check:contract -- --from-tag 0.2.1-rc.2 --to-tag 0.2.2-rc.1
npm run check:contract -- --from-tag 0.2.1-rc.2 --to-tag 0.2.2-rc.1 -- --json report.json
```

它只观测 a 层真正触碰的东西，不做全仓 diff：

1. a 层文件 import 的上游内部模块 —— 是否存在、是否逐字节相同、导出符号是否消失；
2. 公开扩展入口 —— 每个 slot 声明的名字与 kind、`ctx.layout` 方法集、`dsh.client.*` manifest 字段、
   `ISessions` 合约成员；
3. 每一条漂移会影响哪些 a 层文件；
4. 每个“整模块接管”的上游源是否变了。

三种结论：

| 输出 | 含义 | 动作 |
|---|---|---|
| `VERDICT: attachable` | a 层仍能挂上 | 直接构建、门禁、打包 |
| `VERDICT: incompatible` | 某模块消失或丢了我们在用的导出 | 按输出的文件清单改 a 层，**不要改报告** |
| `REVIEW <path>` | 该模块被我们整模块接管，而上游这次也改了它 | forward 仍能过；发布前人工 diff 该模块 |

`--from` 必须是 a 层所依据的 tag（`provenance/source.lock.json` 的 `version`）；
从其它版本起跑时检查器会打印警告，因为已经吸收的漂移会被误报成新漂移。

历史参考（0.2.1-rc.2 → 0.2.2-rc.1 实测）：a 层依赖 10 个上游内部模块，3 个逐字节未变、
7 个内容变化、0 个消失；slot 声明、`ctx.layout` 方法集、manifest 字段、`ISessions` 成员全部未变；
10 个整模块接管中 5 个上游有改动（其余 5 个上游未动）。

---

## 4. 构建

```powershell
node scripts/build-forks-from-source.mjs --build
```

顺序固定为 **stage 上游 → 叠加 `src-overlay/<slug>/` → 应用 `src-patches`**。
overlay 必须在前：patch 可能编辑一个只有 a 层才存在的文件。

产物：`forks-<version>/<slug>/lib/client.js`。构建是字节可重现的：同一份 a 层 + patch
重复构建应得到同一 sha256，`verify-forks-0.2.0.mjs` 会拿记录值比对。

### 4.1 管线适配（每次升级都要看一眼 `tsdown.client.ts`）

`scripts/build-forks-from-source.mjs` 用**官方未修改的** `packages/client/tsdown.client.ts` 预设，
所以上游一改预设，这个脚本就要跟着改。历史变化：

| 版本 | 变化 | 适配 |
|---|---|---|
| 0.2.0-rc.2 | `clientBundle(name, entries)` | 生成 `tsdown.build.ts` 传包名 |
| 0.2.1-rc.2 | 预设新增 `import '../../scripts/experimental-package-policy.ts'` | `stage()` 补拷该文件 |
| 0.2.1-rc.2 | `clientBundle(packageDir, entries, options)`，自己读 `<dir>/package.json` | 生成配置改用 `import.meta.dirname` |
| 0.2.2-rc.1 | 预设经 `modules/src/assets.ts` 解析包资源 | `stage()` 补拷 `assets.ts` |

排查方式：跑 `--stage` 后执行一次 `npx tsdown --config tsdown.build.ts`，报错基本都在提示缺文件或参数形状。

---

## 5. 只在漂移时改代码

### 5.1 改 a 层（优先）

- 新增能力 → 新的 `src-overlay/<slug>/…`；
- 需要改上游算法 → 整模块接管（把模块放进 `src-overlay`，并从 patch 里删掉该文件）；
- 接管后上游又改了它 → 按 §3 的 REVIEW 项人工 diff。

### 5.2 改 patch（例外，必须留理由）

只有在“整模块接管比打补丁更危险”时才保留 hunk（典型：上游还在持续新增内容的字典、类型、
契约模块 —— 接管会静默丢掉上游的新增）。改完：

```powershell
node scripts/build-forks-from-source.mjs --emit-patch <slug>   # 只导出 b 层文件的差异
node scripts/build-forks-from-source.mjs --build
```

`--emit-patch` 不再导出 `src-overlay` 的文件：那些是我们自己的源码，不是补丁。
新增或修改一条例外时，同步更新 [fork-layers 的例外清单](<fork-layers.md#the-exception-list>)。

### 5.3 移植旧 patch 到新上游（仅在附带迁移历史时）

```powershell
git apply --directory=.srcbuild --reject -C1 --whitespace=nowarn `
  src-patches/<slug>/archive-<old-version>/<old-version>-better-tasks.patch
```

处理 `.rej` 的判断原则：

- **上游已经实现了同样的能力** → 直接丢弃该 hunk；
- **上游改了签名/结构** → 把意图移植到新结构上；
- **上游自己新增了同名声明** → 旧 hunk 的“删除”落空会导致重复声明，删掉多余那处；
- 移植完**必须能过 tsc**：`npx tsdown --config tsdown.build.ts` 逐包编译。

---

## 6. 打包与门禁

```powershell
./scripts/pack-forks.ps1 -Version $ver
```

做的事：官方 `<version>` 字节 + fork 的 `lib/client.js` → `npm pack` →
`releases/<version>-forks/deepseek-ai-dsh-client-<slug>-<version>.tgz` +
`candidates.json`（含 `archiveSha256` / `clientSha256`）。

**沙盒冷启动门禁**（真机安装前的强制步骤）：

```powershell
node scripts/prepare-layer-split-sandbox.mjs          # 独立 DSH_HOME + profile，禁用 dsh-cindy-host
# 在沙盒 profile 里安装 six fork tarball + @veewo/dsh-better-tasks
./scripts/layer-split-startup-gate.ps1 -Sandbox sandbox/.desktop-layer-split -SettleSeconds 45
```

判据（全绿才算过）：进程存活、自己拥有监听端口、日志出现 `dsh web: http://…`、页面含
`__DSH_BOOT__`、六个 fork 都出现在 boot manifest、stderr 无致命标记、退出后端口已释放。

### 6.1 重打包 better-tasks

`peerDependencies` 的 `@deepseek-ai/dsh-session-query` / `dsh-storage-domain` 要覆盖新运行时
（上游是精确版本时必须改，否则 `dsh plugin add` 直接 `installation rejected`）：

```jsonc
"peerDependencies": {
  "@deepseek-ai/dsh-session-query": ">=0.2.0-rc.2 <0.3.0-0",
  "@deepseek-ai/dsh-storage-domain": ">=0.2.0-rc.2 <0.3.0-0"
}
```

---

## 7. 安装与真机验证

profile 侧必须同时满足（`pnpm-workspace.yaml`）：

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
```

> 换 linker 或改 hoist 模式后 pnpm 会要求删掉 `node_modules` 重建
> （非 TTY 下会直接 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）：先删 `node_modules` 与
> `pnpm-lock.yaml` 再重装。

**验证只能用真实桌面应用**。`dsh --profile X --port N` 走的是纯 web host
（`dsh-desktop-host/lib/cli.js`），不安装桌面 shell 的模块路由，会给出假绿 ——
这是 0.2.1 迁移里踩过的最大坑。

```powershell
./scripts/desktop-probe.ps1 -SourceProfile <profile>
```

判据：`desktop probe: PASS`、boot manifest 里出现全部已安装 client 插件。
再核对 fork 字节是否就是本次构建（`clientSha256` 来自 `candidates.json`）：

```powershell
Get-FileHash "<profile>\node_modules\@deepseek-ai\dsh-client-ui-layout\lib\client.js" -Algorithm SHA256
```

---

## 8. 已知的坑（按症状查）

| 症状 | 原因 | 处理 |
|---|---|---|
| `startup failed: 1 required plugin did not activate`；`failed to import: Cannot find package '@deepseek-ai/cordis'` | profile 根部有核心包副本 | 改 `isolated`，确认根部 `@deepseek-ai` 只剩六个 fork（+ 插件自身） |
| `web boot: N entries did not activate`，`ui-skill`/`ui-reference`/`ui-secret-mask`/`ui-goal` failed | fork 是上一代构建，缺新导出 | 重建 fork；契约检查器会先报出消失的导出 |
| `dsh: installation rejected: ... is incompatible with dsh X` | `peerDependencies` 是精确版本 | 放宽 peer 区间 |
| `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` | 换 linker 需重建 node_modules | 手动删 `node_modules` + lock 后重装 |
| `tsdown: cannot read <dir>/package.json` | `clientBundle` 第一参已是目录 | 生成配置用 `import.meta.dirname` |
| `Cannot find module .../scripts/experimental-package-policy.ts` | 预设新增内部依赖 | `stage()` 补拷 |
| 沙盒装完但字节对不上 | pnpm 复用了旧 tarball 缓存 | `pnpm install --force`，或重建沙盒目录 |
| CLI 沙盒 PASS 但真机崩 | CLI 路径不装模块路由 | 只用 `desktop-probe.ps1` 或 `layer-split-startup-gate.ps1` |

---

## 9. 回滚

- 代码：`git checkout <上一个 tag>`；
- profile：升级前备份 `<profile>` 的 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml`，
  回滚时覆盖回去并删 `node_modules`；
- 运行中出问题：把 `<profile>/node_modules` 改名，应用会退回纯 stock 树。

---

## 10. 文件地图

| 路径 | 作用 |
|---|---|
| `provenance/source.lock.json` | 上游 tag / sha256 / 构建工具链（构建管线与契约检查的唯一输入） |
| `third_party/source/<tag>.tar.gz` | vendored 上游源码 |
| `third_party/<slug>/<version>/package/` | 各 fork 对应的官方基线字节（externals 校验用） |
| `src-overlay/<slug>/**` | **a 层**：我们自己的源码与整模块接管 |
| `src-patches/<slug>/<version>-better-tasks.patch` | 仅 b 层文件的增量（例外清单见 fork-layers） |
| `src-patches/<slug>/archive-<old>/` | 上一代补丁，移植时参考 |
| `forks-<version>/<slug>/lib/client.js` | 构建产物 |
| `releases/<version>-forks/` | 可安装 tarball + `candidates.json` |
| `scripts/check-upstream-contract.mjs` | **契约漂移报告** |
| `scripts/build-forks-from-source.mjs` | stage / overlay / apply / build / emit-patch 全流程 |
| `scripts/pack-forks.ps1` | 官方字节 + fork 产物 → tarball |
| `scripts/desktop-probe.ps1` | 真机启动探针 |
| `scripts/prepare-layer-split-sandbox.mjs` + `scripts/layer-split-startup-gate.ps1` | 沙盒冷启动门禁 |
| `docs/fork-layers.md` | a/b 层边界与例外清单 |
