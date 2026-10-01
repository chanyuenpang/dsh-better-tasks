# Better Tasks 0.3 Desktop public-release procedure

This is the current procedure for **DSH Desktop 0.2.0-rc.2**. The former 0.1.5 Web/local-unscoped line is preserved in [legacy release notes](<release-legacy-0.2.md>) and is not the install recipe for 0.3.

## Distribution contract

- The public npm bundle is `@veewo/dsh-better-tasks` (0.3.0 starts the Desktop line). Its `dsh.bundle.patch` is shipped as [the package layer](<../cordis.patch.yml>).
- Six exact native-named Client forks are dependencies, downloaded from a separately revisioned, immutable [GitHub asset library](https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/better-tasks-forks-0.2.0-rc.2-r1). Do not publish those names to the upstream npm scope, rename their ModuleLoader identities, or use a developer `file:G:/...` dependency in a public package.
- A main release includes its main tgz, the same six fork tgz files, a sanitized SHA-256 manifest and release notes. Preserve upstream licenses. Never overwrite bytes under an existing version/tag/filename; a changed fork requires a new library revision and main version.
- Public assets/source commits exclude Profile backups, credentials, Session stores, runtime/sandbox logs, tokens and `.claw` session data. Use explicit path/file allowlists, never `git add .` or a recursive zip of a deployment directory.

## Prepare once

1. Obtain explicit release permission and compatibility/version agreement; verify npm write rights and GitHub repository permission without printing tokens.
2. Freeze user-accepted functionality. Update the main manifest/version, public dependency URLs, supported native peer versions, README and release notes. Keep source/fork provenance reproducible.
3. If this is a new fork library, commit/tag the audited fork source, publish its exact archives as a non-latest prerelease asset library, and verify anonymous download hashes before using those URLs. This avoids a cyclic requirement between a main tag's dependency URLs and generating its lockfile. It is not yet the stable main release.
4. Generate/update the source lockfile from publicly reachable dependencies (no local dependency specs), build/test the completed batch once, and create one immutable main tarball. The current public-release pack helper validates the npm file list and accepted main/fork digests. Do not rebuild a main or fork during installation of an already verified identical archive.
5. Commit only reviewed source, tests, provenance, public docs and sanitized manifests. A release tag must point to the actual source commit used for its archive, not an old base revision. Do not force-move existing tags.

## Exact package-mode startup gate

For every **new public archive or dependency composition**, cold-start that exact package-manager-resolved graph in its own Desktop sandbox before npm promotion:

- Independent `DSH_HOME`, desktop Profile, Session storage, ledger and Electron user-data; never point it at real storage.
- Disable Cindy Host. Keep candidate rows, native disables and fork identities exactly as the published bundle specifies.
- Confirm the Host listening endpoint and the actual `dsh-app://app/` preload/core root, sidebar, Session, Workspace and conversation activation with no startup errors/service-wait deadlock. Compare served bundle bytes to candidate digests.
- Startup only, not feature/visual QA. User acceptance remains authoritative; do not measure computed CSS, geometry or pixels as a routine release check.
- Stop the owned Desktop/Host tree and verify every owned process and listener has disappeared before touching any real Profile. Record startup and cleanup evidence, sanitized before public upload.

The accepted Desktop local archive is not sufficient evidence for a public manifest whose dependency locations changed. A public-URL install must resolve successfully and match the same fork bytes. Failed gating prevents stable publication; it is not a reason to restart or patch the real Desktop.

## Publish and verify

After all gates pass, publish the **exact verified main tgz** to the official npm registry:

```powershell
npm.cmd publish releases/0.3.0/veewo-dsh-better-tasks-0.3.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm.cmd view '@veewo/dsh-better-tasks@0.3.0' name version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org/
```

Verify registry version/integrity against the archive and verify `latest`. If authentication or OTP is required, pause transparently for the user; never report a queued/failed publish as success.

Publish/promote the main [GitHub release](https://github.com/chanyuenpang/dsh-better-tasks/releases) and its immutable source tag, upload only the safe asset list, then re-read URLs, asset sizes/digests and final non-draft/non-prerelease status. Keep the fork library separate from the repository's latest plugin release.

Publishing is **not** a real-Profile upgrade or restart. The user's accepted local Desktop stays installed unless a separate update is requested. Future installation of an identical archive/graph can reuse its technical evidence after verifying composition/hashes; it does not need another build or feature sandbox run.

## Development source tests

The pinned fork source is generated under ignored `.srcbuild/`, using [the source lock](<../provenance/source.lock.json>) and [recorded patches](<../src-patches/>). On a fresh clone use Node 24+, `npm ci --ignore-scripts`, then `npm run test:prepare` before `npm test`. The prepare mode only stages/applies test source contracts and toolchain, not accepted fork lib artifacts. A deliberate `npm run build:fork` changes artifacts and therefore requires fresh provenance/package validation.

Unified-diff context whitespace and byte-locked upstream artifacts are retained; validate authored code/docs separately rather than normalizing vendor bytes and breaking hashes.
