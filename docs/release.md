# Better Tasks 插件发布流程

本项目的正式 DSH Profile 必须加载不可变插件包，禁止直接引用开发 checkout。这样修改 `src/`、`forks/` 或重新构建项目都不会影响正在运行的 DSH；升级必须经过“构建 → 打包 → package-mode sandbox → Profile 安装 → composition 切换 → 重启回归”的完整流程。

## 发布物

每个版本发布四个 tgz：

- `dsh-better-tasks-<version>.tgz`
- `deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz`
- `deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz`

三个 fork 保留上游包名和 `0.1.5-rc.2` 基线，确保 Client 注入身份不变；它们的 tgz 内容由本仓库 provenance/patch 校验保证。`manifest.json` 记录每个文件的 SHA-256、大小和源提交。

## 1. 发布前验证

```powershell
npm test
npm run check
```

两条命令必须通过，包括三个 exact-fork provenance replay。修改 `package.json` 中 Better Tasks 的版本号；不要随意修改 fork 的包名或基线版本。

## 2. 构建不可变包

以下以 `0.2.0` 为例：

```powershell
$release = Join-Path $PWD 'releases\0.2.0'
New-Item -ItemType Directory -Force $release | Out-Null
npm run build
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
  "$release\dsh-better-tasks-0.2.0.tgz" `
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
      name: dsh-better-tasks
```

通过条件：Host 成功监听、核心页面激活、设置页交互与跨刷新持久化通过、浏览器错误为 0。结束后必须停止并确认 `:3081` 无监听。

## 4. 安装到正式 Profile

先把 tgz 复制到项目目录外的版本化发布库，再从发布库安装：

```powershell
$version = '0.2.0'
$source = Join-Path $PWD "releases\$version"
$releaseRoot = Join-Path $env:USERPROFILE ".dsh\plugin-releases\dsh-better-tasks\$version"
New-Item -ItemType Directory -Force $releaseRoot | Out-Null
Copy-Item "$source\*" $releaseRoot -Force

dsh plugin --profile web add `
  "$releaseRoot\dsh-better-tasks-$version.tgz" `
  "$releaseRoot\deepseek-ai-dsh-client-ui-layout-0.1.5-rc.2.tgz" `
  "$releaseRoot\deepseek-ai-dsh-client-ui-workspace-0.1.5-rc.2.tgz" `
  "$releaseRoot\deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz"
```

确认 `${DSH_HOME:-$HOME/.dsh}\profiles\web\package.json` 的依赖指向发布库 tgz。再备份并编辑用户 Profile 的 `cordis.patch.yml`，把四个 `file:///.../Projects/...` 行替换为上述四个包名。不得编辑 DSH 安装目录或 shipped preset。

由于 Profile 可启用 live patch reload，写 patch 前必须已通过 package-mode sandbox；写入后仍要按正常流程取得明确确认，再以 grace period 重启正式 `dsh web`。

## 5. 正式回归

重启后检查：

1. `:3080` 只有一个 listener，`:3081` 无 listener；
2. composition 中四个 Better Tasks 行均从 Profile package 解析，不含开发 checkout 路径；
3. 设置页显示 Better Tasks Tab；
4. 字号、三个独立默认展开选项和列布局修改后立即生效并跨刷新保存；
5. Goal 默认折叠，展开 Todo 不改变 Goal；
6. Pin/Unpin optimistic 反馈、Host CAS、Final 与 Workspace 功能无回归；
7. 浏览器 console/runtime 错误为 0。

## 回滚

保留上一版本发布目录和 patch 备份。回滚时：

1. 用 `dsh plugin --profile web add <上一版本 tgz...>` 恢复上一组依赖；
2. 恢复上一份 package-name `cordis.patch.yml`；
3. 取得确认后重启 `dsh web`；
4. 不删除 Session、Goal、Todo、Pin queue、project appearance 或 `better-tasks-ui` settings 数据。

不要把 composition 改回开发 checkout 作为普通回滚手段；项目路径只允许用于隔离开发 sandbox。