# Better Tasks for DSH Desktop

A compositional sidebar and pinned-task view for **DSH Desktop 0.2.x**. The 0.3 line uses the native Workspace Registry as the single Pin owner and ships a removable Cordis bundle with six exact, audited Client compatibility forks.

> **Runtime baselines:** the six client UI forks are rebuilt from each dsh source tag. `forks-0.2.0-rc.2/` is the audited 0.2.0-rc.2 library; `forks-0.2.1-rc.2/` is the 0.2.1-rc.2 rebuild that the Desktop 0.2.1 runtime loads (see [forks-0.2.1-rc.2 assets](<releases/0.2.1-rc.2-forks/candidates.json>)). The step-by-step rebase procedure for the next dsh line is [upgrading-dsh-version](<docs/upgrading-dsh-version.md>).

> **Compatibility change:** 0.3.1 targets the Desktop 0.2 runtime, not the legacy 0.1.5 Web composition. Legacy users should keep their existing compatible release (npm 0.2.4); do not bypass DSH peer-version checks.

## Install

Better Tasks replaces six app-owned Client UI modules, so a DSH Desktop install is **two steps**: the plugin, and the six audited fork payloads that its `cordis.patch.yml` mounts. The fork payloads keep their original `@deepseek-ai/dsh-client-ui-*` names and ModuleLoader ids, so the app's other plugins resolve them unchanged.

```powershell
# 1) the plugin (npm)
dsh plugin --profile desktop add @veewo/dsh-better-tasks@0.3.2

# 2) the six forks, from the fork-library release for YOUR dsh line
$tag = 'better-tasks-forks-0.2.1-rc.2-r1'   # 0.2.1 runtime; 0.2.0 runtime uses ...-0.2.0-rc.2-r1
$base = "https://github.com/chanyuenpang/dsh-better-tasks/releases/download/$tag"
$forks = 'layout', 'workspace', 'user-questions', 'input-trigger', 'commands', 'conversation'
dsh plugin --profile desktop add ($forks | ForEach-Object { "$base/deepseek-ai-dsh-client-ui-$_-0.2.1-rc.2.tgz" })
```

The profile must keep those six names at its root so `ui-layout`/`ui-conversation`/… resolve to the forks rather than to the shipped modules. `pnpm-workspace.yaml` in the profile:

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

> `nodeLinker: hoisted` also installs the forks, but the Desktop 0.2.1 client-modules composition then drops this plugin's own client half; `isolated` + `publicHoistPattern` is the layout the real-app gate passes. Run `scripts/desktop-probe.ps1 -SourceProfile desktop` before trusting a new install.

Restart Desktop if Plugin Manager reports **restart required**. Installing a package is not the same as the running page loading it. Do not enable the shipped `ui-sidebar` simultaneously: the bundle owns the replacement layer and restores native rows when removed. For release/rollback procedure see [release](<docs/release.md>) and [rollback](<docs/rollback.md>), and for the next dsh line see [upgrading-dsh-version](<docs/upgrading-dsh-version.md>).
## Features

- Switch between the native Session browser and a task swimlane in the same sidebar; native search, Workspace grouping, rename, archive and directory operations remain.
- Native Pin membership is shared with official Session rows. Better Tasks persists a separate task-card order, not a second membership truth. New Session paths use the same native action and auto-Pin lifecycle hook.
- Cards keep the native running StateDot, localized relative time and current main-view selection. Clicking a card immediately opens its Session. Double-clicking its non-interactive area toggles Final: close immediately when expanded; open only when a current, nonempty Final preview is available.
- Final is a bounded, read-only Host projection (up to 4000 Unicode code points). The currently browsed task does not automatically expand Final for a new idle cycle; manual choices win, and navigation does not retroactively expand it. Cold startup catalog fallback/hydration does not erase saved choices or lower the consumed activity watermark.
- Independent native input surfaces let pinned idle tasks receive messages, commands and skill insertion without changing the main view. Hidden input retains its draft. Ordinary native questions can be answered inside cards through the same draft/settlement owner; plan-review approval stays in its native panel.
- Host-backed settings configure detail/question text size (11–16), default disclosures, native/tasks view, task/project title emphasis, and auto/single/double columns. Auto uses two independent vertical flows only above 528px. Input remains subordinate to expanded Final, rather than pretending every disclosure is display-independent.
- Native layout owns sidebar width and collapse. Its last positive width is retained. Windows caption controls remain reachable at zero-width collapse; macOS uses the legal frame-owned `shell.leading` reopen/New Session seat. Browser-style rails keep their existing behavior.

## Distribution and provenance

The six forks preserve upstream package names, ModuleLoader identities, `0.2.0-rc.2` baseline and licenses. They are **not official upstream npm releases** and are not published to the `@deepseek-ai` registry scope. Audited bytes and SHA-256 manifests are release assets; source patches are under [src-patches](<src-patches/>) and upstream source is pinned by [source lock](<provenance/source.lock.json>). Changing a fork requires a new asset-library revision and a new main version; never replace an archive under an existing URL.

The source tag/release is [v0.3.1](https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.1). Release assets contain code archives and sanitized manifests only, never real Profile backups, Session stores, credentials or runtime logs.

## Development

Use Node **24+** for the source-contract tests (`stripTypeScriptTypes`) and install developer dependencies:

```powershell
npm ci --ignore-scripts
npm run test:prepare  # stage pinned, patched TS test sources; does not rebuild fork artifacts
npm test             # build the main client, then run unit/contract tests
npm run check
```

`npm run build:fork` is a deliberate source-fork rebuild for development, not a routine main release step. It uses the pinned upstream tag and official preset; revalidate changed bytes before deployment. `.srcbuild/` is generated and ignored. Never point a real Profile at the mutable checkout.

Technical unit/package/startup checks do not replace user acceptance. Desktop candidates must cold-start in isolated storage with Cindy disabled, and every sandbox process/listener must be removed before real installation. Functional and appearance acceptance belong to the user; the agent does not automatically restart the real Desktop.
