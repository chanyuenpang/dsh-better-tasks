# Better Tasks for DSH Desktop

A compositional sidebar and pinned-task view for **DSH Desktop 0.2.x**. The 0.3 line uses the native Workspace Registry as the single Pin owner and ships a removable Cordis bundle with six exact, audited Client compatibility forks.

> **Runtime baselines:** the six client UI forks are rebuilt from each dsh source tag. `forks-0.2.0-rc.2/` is the audited 0.2.0-rc.2 library; `forks-0.2.1-rc.2/` is the 0.2.1-rc.2 rebuild that the Desktop 0.2.1 runtime loads (see [forks-0.2.1-rc.2 assets](<releases/0.2.1-rc.2-forks/candidates.json>)). The step-by-step rebase procedure for the next dsh line is [upgrading-dsh-version](<docs/upgrading-dsh-version.md>).

> **Compatibility change:** 0.3.1 targets the Desktop 0.2 runtime, not the legacy 0.1.5 Web composition. Legacy users should keep their existing compatible release (npm 0.2.4); do not bypass DSH peer-version checks.

## Install

In DSH Desktop **Settings → Plugins**, install the public bundle:

```text
@veewo/dsh-better-tasks@0.3.1
```

The npm main package is [`@veewo/dsh-better-tasks`](https://www.npmjs.com/package/@veewo/dsh-better-tasks). It includes all six native-named fork payloads using npm `bundledDependencies`, so default pnpm protection against URL subdependencies remains enabled. The same reviewed archives are available as [GitHub release assets](https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/better-tasks-forks-0.2.0-rc.2-r1); there are no developer-machine paths, URL subdependencies or fork-name renaming. A package-local Loader subtree resolves native names from those bundled payloads and retains the original input/commands/conversation option IDs.

Restart Desktop if Plugin Manager reports **restart required**. Installing a package is not the same as the running page loading it. Do not enable the shipped `ui-sidebar` simultaneously: the bundle owns the replacement layer and restores native rows when removed. For release/rollback procedure see [release](<docs/release.md>) and [rollback](<docs/rollback.md>).

> **DSH Desktop 0.2.1-rc.2:** 0.3.1 is rejected by the 0.2.1 peer gate. A 0.3.2 package for the 0.2.1 fork line is prepared but not published — its clean-install desktop gate still fails (see the blocker note in [release](<docs/release.md>)). Until that is fixed, run the 0.2.1 line with the procedure in [upgrading-dsh-version](<docs/upgrading-dsh-version.md>): the six forks as direct profile dependencies hoisted to the profile root.

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
