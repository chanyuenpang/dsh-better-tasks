# Better Tasks Desktop public-release procedure

Current release: **0.3.1**, for DSH Desktop **0.2.0-rc.2**. The 0.3.0 preparation tag is retained but was not published to npm: URL subdependencies failed default pnpm `blockExoticSubdeps` protection. Do not force-move that tag or disable the protection.

> ## 0.3.2 is prepared but NOT published — known blocker (2026-10-18)
>
> 0.3.2 exists to ship the six forks rebuilt on the **0.2.1-rc.2** line (see `docs/upgrading-dsh-version.md`).
> The source work is done and verified — patches, builds and tarballs are in `forks-0.2.1-rc.2/` and
> `releases/0.2.1-rc.2-forks/`, `npm test` is 417/417 — but the **self-contained packaging shape does not
> survive the 0.2.1 runtime**, so the tarball is not published:
>
> | check | result |
> |---|---|
> | `@veewo/dsh-better-tasks@0.3.1` installed on 0.2.1 | `installation rejected` (exact peers) |
> | 0.3.1 + exact-version exemption, clean profile, real desktop app | boots, but its client half is **not served** (`1 installed, 0 in boot manifest`) |
> | 0.3.2 (widened peers, 0.2.1 payloads), clean profile, real desktop app | boots, client half served, but the six fork rows nested under `better-tasks-forks` never provide `layout` / `uiConversation` / `uiWorkspace` → **21 client entries stay pending** (`web boot: 21 entries did not activate`) |
> | same package with `file://` rows instead of the nested group | boots with no pending entries, but the plugin's own client half is again not served |
>
> The verified 0.2.1 install path today is **not** this package shape: it is six forks as direct profile
> dependencies hoisted to the profile root (`publicHoistPattern`) plus better-tasks as a plain profile
> dependency. That configuration passes the real-app probe with 16/16 client plugins. Reproducing it from a
> published tarball needs a fix to how a profile-mounted client plugin's nested module tree reaches the
> client module graph on 0.2.1. Do not publish 0.3.2 until the real-app gate passes for a clean install.

## Self-contained distribution

The public `@veewo/dsh-better-tasks` main tarball uses npm `bundledDependencies` to include six exact native-named Client fork payloads. Dependency specs remain regular `0.2.1-rc.2` versions, not machine-local paths or URL subdependencies. Their original names, ModuleLoader IDs and licenses are retained; nothing is published to the upstream npm scope.


The same six archives remain downloadable from the [immutable fork library](https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/better-tasks-forks-0.2.0-rc.2-r1) and are attached to the main release with a sanitized hash manifest.

[The removable patch](<../cordis.patch.yml>) mounts [a package-local Loader subtree](<../src/fork-layer.mjs>). The subtree owns its independent entry store and resolution base: it resolves native package names from bundled node_modules, not a stock fallback in the app. The input/commands/conversation option IDs remain native so user config assertions can still target them. Layout, UI, Pin and Session ownership remain inside their existing packages, not in this assembly group.

## Prepare and audit

1. Verify release permission, native compatibility and npm/GitHub publishing rights without printing tokens.
2. Finish the batch before testing. Freeze accepted feature code and fork digests; update manifest, packaging layer and docs only as needed.
3. Stage a separate self-contained package via [the staging helper](<../scripts/stage-self-contained-release.mjs>), checking each bundled Client digest. Never blindly npm-pack stock registry forks after a developer install replaced them.
4. Build the main client, run necessary unit/contract checks, npm-pack the staged directory once, and audit every payload path, dependency, bundled identity, main/source digest and license. Exclude real Profiles, credentials, Session data, runtime/token logs, backups and workflow data.
5. Use explicit source/asset allowlists, not `git add .` or a recursive deployment-directory zip. Commit/tag the exact source used by the package. Do not force-move tags or overwrite an archive used for verification.

## Startup gate

A new archive or composition must install with **default pnpm protections** and cold-start in its exact package-manager-resolved Desktop graph. Use separate DSH_HOME/Profile/Session storage/ledger/Electron user-data and disable Cindy Host. Confirm Host listening and actual `dsh-app://app/` preload/core layout/sidebar/Session/Workspace/conversation activation with no startup errors, and compare the seven served Client digests to candidates.

Sandbox validation is startup-only, not feature or visual QA. Stop the owned process tree and verify all owned processes/listeners disappear. Never modify/restart the real Desktop to repair a failed package gate. Unit/package/startup evidence does not replace user acceptance.

## Publish verified bytes

```powershell
npm.cmd publish releases/0.3.1/veewo-dsh-better-tasks-0.3.1.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm.cmd view '@veewo/dsh-better-tasks@0.3.1' name version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org/
```

Publish only the exact verified archive. Re-read registry integrity/version/latest, download/hash-check GitHub assets and confirm stable/non-draft status. Auth/OTP failures must be reported and waited on, not called success. Public evidence must be sanitized; source/asset commits must never contain private deployment files.

Publishing is not a real-Profile installation or restart. The accepted local Desktop 0.2.18 remains unchanged unless the user separately requests an upgrade. For rollback see [rollback](<rollback.md>); the obsolete Web recipe is retained under [legacy release notes](<release-legacy-0.2.md>).

## Development

Use Node 24+, install dependencies, restore the reviewed fork payloads from pinned assets, then run `npm run test:prepare` to stage/apply the TS source contracts before `npm test`. The source is pinned by [source lock](<../provenance/source.lock.json>), with reviewed [patches](<../src-patches/>). `npm run build:fork` is a deliberate rebuild requiring new provenance/archive validation, not a routine public main release step. Keep original vendor and unified-diff context whitespace; do not normalize it and break digests.
