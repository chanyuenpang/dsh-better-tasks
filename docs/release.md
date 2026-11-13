# Better Tasks：按 DSH 版本发布

## 当前组合与 tag 规则

- DSH Desktop 运行时：**0.2.2-rc.2**。
- Better Tasks npm/package 版本：**0.4.0**。
- Git tag / GitHub Release：**`dsh-v0.2.2-rc.2-tasks-v0.4.0`**。
- 安装入口：[安装说明](<install.md>)；旧版兼容表见 [README](<../README.md>)。

今后统一使用 `dsh-v<DSH版本>-tasks-v<Tasks版本>`。DSH 版本写完整，保留 rc 后缀；Tasks 版本仍由插件自己的 manifest 管理。同一 Tasks 源码可适配多条 DSH 线，但每条线都要有独立验证的组合 Release。已发布的 tag 与资产 URL 不移动、不覆盖；内容变化应升 Tasks 版本并创建新组合 tag。面向 RC 运行时的本次组合标记为 GitHub Pre-release，不依赖全局 Latest 作为安装入口。

## 本次内容

侧栏任务泳道、原生 Pin、Final 预览、独立输入与问答卡片；rc.2 行菜单适配新的 context-menu factory slot，并透传 Workspace/quote/empty-submit 参数。包含最新 questions 修复：问答 composer 选择器失败时退出竞选，让原生输入框回退，不再用区域错误边界吞掉整个输入区。

**完整分发是七个独立 tarball，不是 bundledDependencies 或嵌套 Loader 树。** 六个 fork 保留原生包名、ModuleLoader ID、上游版本及许可证，以 Profile 根依赖安装；插件自身依赖不携带 fork。早期 `better-tasks-forks-0.2.2-rc.2` 库保留为历史资产，不覆盖，其中 questions 包并非本次最终修复字节。

## 一次性准备、构建与审计

1. 确认 GitHub 写权限、源码提交和目标运行时。保留用户未提交的工作，仅显式暂存本次发布文件。
2. 完成全部代码与文档改动，更新 [安装说明](<install.md>)、[回滚说明](<rollback.md>)、兼容矩阵和 lockfile 根版本，然后统一验证。
3. Node 24+ 下准备测试源码并运行 `npm run test:prepare`、`npm test`、`npm run check`；对目标线运行 `node scripts/check-upstream-contract.mjs --from-tag 0.2.2-rc.2 --to-tag 0.2.2-rc.2 --version 0.2.2-rc.2`。测试源码默认线由 source lock 管理，与发布线必须分别说明。
4. 使用已审查的六个 rc.2 fork，检查每个包内客户端与 [fork 构建产物](<../forks-0.2.2-rc.2/>) 的哈希一致。不要误打包 npm 官方未修改模块。只有需要改变 fork 字节时才重建 fork，并重新记录来源。
5. 在新的 `releases/<组合tag>/` 打包插件本体一次；其余六包复制已验证字节。检查所有 tar 路径和包名、版本、许可、依赖、bundle patch、源码与客户端哈希。公开包仅含代码、文档和许可证，禁止任何 Profile、凭据、Session、日志、备份或工作流状态。
6. 生成 `release-manifest.json`：组合 tag、两种版本、上游来源、七个文件名/大小/archiveSha256/clientSha256。只用相对文件名，不泄露本机路径。生成 `SHA256SUMS.txt`，附 `INSTALL.md`、`ROLLBACK.md` 和脱敏 `validation.json`。清单副本保存在 provenance 下供源码 tag 追溯。

## 隔离冷启动门禁

最终七包必须在目标运行时的精确组合中冷启动。独立 DSH_HOME、Profile、Session/ledger 和 Electron user-data；禁用 `dsh-cindy-host`，监听仅 loopback，使用与安装说明相同的 isolated/hoist 策略。不得把沙盒指向真实 Profile 存储。

确认监听地址、实际浏览器核心 shell/侧栏/Session/Workspace/会话激活，无启动错误或可选服务等待死锁，并核对七个 served client 的哈希。只做启动验证，不做功能交互、截图或像素 QA。记录命令、目标版本、隔离 Profile、URL（公开证据移除 token）、浏览器错误与清理结果。退出全部自有沙盒进程并确认监听消失。失败时修复并重跑必要检查，不动真实 DSH。

## 提交、tag 与发布

审查最终 diff，通过后提交准确源码；仅推送需要的分支与新 annotated tag，不用 `--tags` 批量推送历史标签，不 force push。

```powershell
$tag = 'dsh-v0.2.2-rc.2-tasks-v0.4.0'
git tag -a $tag -m 'Better Tasks 0.4.0 for DSH 0.2.2-rc.2'
git push origin HEAD
git push origin "refs/tags/$tag"
# gh release create 用 --verify-tag，显式上传审计后的资产；先 draft，上传完成再公开。
```

Release 标题包含 DSH 与 Tasks 两种版本，说明链接固定到该 tag 的安装文档。上传完整七包和清单，不使用会匹配 Profile/日志的递归通配上传。发布后确认非 draft、组合 tag 对应准确提交；匿名逐个下载七包并与清单 SHA-256 对照。GitHub Release 发布与 npm 发布、真实 Profile 安装/重启互相独立，本流程不自动执行后两者。
