# Better Tasks Desktop public-release procedure

Current release: **0.3.2**, for DSH Desktop **0.2.1-rc.2** (0.3.1 remains the 0.2.0-rc.2 line). The 0.3.0 preparation tag is retained but was not published to npm: URL subdependencies failed default pnpm `blockExoticSubdeps` protection. Do not force-move that tag or disable the protection.

> ## 0.3.2 — the 0.2.1-rc.2 fork line (published 2026-10-18)
>
> 0.3.2 ships the six forks rebuilt on the **0.2.1-rc.2** line (see `docs/upgrading-dsh-version.md`).
> Unlike 0.3.1 the package no longer bundles fork payloads: the Desktop 0.2.1 runtime rejects both a
> nested Loader subtree (its rows never reach `window.__DSH_BOOT__`, leaving 21 client entries pending)
> and subpath row names (`client-modules` only accepts exact package specifiers). The install is
> therefore two steps — plugin from npm, six forks from the fork-library release — with the profile
> keeping those six names at its root via `nodeLinker: isolated` + `publicHoistPattern`. The full
> procedure is in the README.
>
> Release gate used for 0.3.2 (real desktop application, isolated DSH_HOME, clean profile):
> `scripts/desktop-probe.ps1` → PASS, `7 installed / 7 in boot manifest`, no pending entries.
> Note for anyone re-running it: with `nodeLinker: hoisted` the same bytes fail the gate (the plugin's
> own client half is dropped), so the linker layout is part of the acceptance, not a preference.
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

## Publish verified bytes (optional)

> **npm is not the install path.** Since 0.3.2 the authoritative, cross-version procedure is
> [install](<install.md>): the plugin plus the six fork payloads built for the same dsh line, installed
> from release tarballs. The npm package is a convenience entry and version marker only — 0.3.2 is
> published with an `npm deprecate` notice pointing back to `docs/install.md`. Publishing is still
> useful to keep a version marker public, but it must never be described as a complete install, and no
> release note may imply that `npm i` alone produces a working Better Tasks.

```powershell
npm.cmd publish releases/0.3.1/veewo-dsh-better-tasks-0.3.1.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm.cmd view '@veewo/dsh-better-tasks@0.3.1' name version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org/
```

Publish only the exact verified archive. Re-read registry integrity/version/latest, download/hash-check GitHub assets and confirm stable/non-draft status. Auth/OTP failures must be reported and waited on, not called success. Public evidence must be sanitized; source/asset commits must never contain private deployment files.

Publishing is not a real-Profile installation or restart. The accepted local Desktop 0.2.18 remains unchanged unless the user separately requests an upgrade. For rollback see [rollback](<rollback.md>); the obsolete Web recipe is retained under [legacy release notes](<release-legacy-0.2.md>).

## Development

Use Node 24+, install dependencies, restore the reviewed fork payloads from pinned assets, then run `npm run test:prepare` to stage/apply the TS source contracts before `npm test`. The source is pinned by [source lock](<../provenance/source.lock.json>), with reviewed [patches](<../src-patches/>). `npm run build:fork` is a deliberate rebuild requiring new provenance/archive validation, not a routine public main release step. Keep original vendor and unified-diff context whitespace; do not normalize it and break digests.
