# Better Tasks 0.3.1 public-release evidence

- npm: https://www.npmjs.com/package/@veewo/dsh-better-tasks/v/0.3.1
- Registry version and `latest`: **0.3.1**; publish exited 0 and was independently re-read.
- GitHub stable release: https://github.com/chanyuenpang/dsh-better-tasks/releases/tag/v0.3.1
- GitHub: non-draft, non-prerelease, seven tgz files plus a sanitized manifest. Anonymous downloads of all seven archives match recorded SHA-256; downloaded manifest equals local public manifest.
- Main archive SHA-256: `899713f9d81750a18e23cb2e456dd7f001a29c6162b4ee6a8e04b14b0303ca9b`.
- npm integrity: `sha512-lyKjQDBAaxxJMjCmmrxK2ROmsHvuO6zSu7os3g9JA4IXDmQtOGvpb/jCDkp2vzQtHG2h3u9RB50YQ+idYeoV4w==`. Anonymous registry tarball download matches the exact gate-passed archive.
- Source tag: `v0.3.1`, source commit starts `8f2de06`; every own npm payload file matches the fixed source stage. Old `v0.3.0` preparation tag remains immutable and was never an npm release.

## Technical verification

- Accepted Desktop 0.2.18 feature code and main Client digest retained; only package assembly added. Six native-named fork payload digests match accepted archives.
- Full pre-repair unit/contract batch: 417/417. Necessary corrected EntryTree/package-boundary contracts: 4/4, plus source syntax/package checks.
- Default pnpm 11.7 protection install: PASS. No URL subdependencies or machine-local public dependency specs, six native identities and licenses bundled.
- Exact isolated Desktop 0.2.0-rc.2 cold startup: PASS on actual `dsh-app://app/`; preload, all Client activation, sidebar, Workspace and conversation ready; seven served Client digest checks and empty error collection. Startup-only, no feature/visual QA.
- Own Electron/Host process tree and 39422/9228 listeners removed: PASS. Real installed main remains local 0.2.18; no real reinstall, configuration edit or restart performed.

## Rejected candidates and lessons

The 0.3.0 URL-dependency attempt failed default `blockExoticSubdeps`. The first 0.3.1 Group-scoped attempt failed startup sidebar registration. Neither was called a successful release or used to alter the real Profile. A Group reuses its parent EntryTree; Loader imports and Client metadata read `entry.parent.tree.ctx.baseUrl`. The released archive uses a real independent EntryTree and was gated again.

The task took excessively long and violated the user's ten-minute reporting limit during diagnosis/implementation. This was acknowledged; no timing-success claim is made. Future publication must gate packaging policy and runtime resolution before creating final source tags, and use bounded tasks with evidence checkpoints.

Public source/assets contain no real Profile backups, Session stores, credentials or raw token/runtime logs. Detailed private local evidence is intentionally not attached to the public release.
