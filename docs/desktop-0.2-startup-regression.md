# Desktop 0.2.0-rc.2 — startup regression follow-up

## Findings, not assumptions

- The earlier successful enabled-state check did not prove that disabling the provider was safe. Desktop crash logs at 2026-09-30T10:54–11:01Z explicitly report `uiWorkspace` waiting for `betterTaskPins`, followed by conversation/Goal/Plan/Trajectory/Deliverables waits.
- That hard injection is in the Better Tasks workspace **fork**, not the official 0.2.0-rc.2 source. The native package name had obscured the distinction.
- The reported `require("clsx") missed the module table` is a valid factory-load failure mechanism. However, both inspected old archive batches and the quarantined desktop questions file already inline clsx. The exact historical failing bytes have **not** been recovered; do not claim the current archives reproduced that error.
- Earlier sandbox setup linked the other two forks from the live install. It did not prove all delivered archives matched the tested bytes. This follow-up installs all four archives through pnpm into an independent profile and compares the actual Desktop-served executable source.

## Minimal repairs

1. [Workspace optional bridge](../.srcbuild/packages/client/ui-workspace/src/client/task-pins.ts) keeps a stable empty snapshot, mounts a nonblocking child injection, and detaches on provider disposal. Native workspace/session operations remain active. Task pin controls disappear without the provider. Arrival, replacement, rejection and disposal have regression tests.
2. [External-module validator](../scripts/verify-fork-externals.mjs) uses the existing TypeScript AST parser, detects side-effect imports and require.async, ignores comments/strings, supports an explicit candidate directory and fails on missing/unknown packages. It has no implicit download fallback.
3. [Build gate](../scripts/build-forks-from-source.mjs) rejects every UNRESOLVED_IMPORT and checks module edges before publishing built bytes. clsx must be bundled, not added to the runtime module table.
4. [New staging script](../scripts/stage-desktop-startup-repair.mjs) packages **all three forks plus Better Tasks 0.2.7**. Better Tasks is the only selectable bundle; its three local, immutable archive dependencies are ordinary packages. The bundle owns the replacement patch layer. Native-named forks are no longer individually sent to `install_bundle`.

The current Desktop profile uses the hoisted pnpm linker. This matters: same-name transitive fork packages must be physically selected from the profile root, rather than silently falling back to built-in packages. The acceptance below verified this selection by served-code equality. Do not assume an isolated-linker install has identical resolution.

## Acceptance and cleanup

- [192/192 regression tests](../sandbox/desktop-startup-regression-tests-final.log), including 6 optional-provider lifecycle tests and 15 external-module gate tests.
- [Exact four-package fingerprints](../releases/0.2.7-desktop-startup/candidates.json).
- Independent home/profile/session/ledger and fresh Electron user-data for each cold start. No live-profile fork junctions; pnpm actually installed the bundle and its full graph. Cindy disabled in the sandbox.
- Installed executable: `H:\Program Files\Deepseek\DeepSeek Harness.exe`; actual renderer `dsh-app://app/` with preload. Sandbox Host 39422, CDP 9228; not an HTTP browser substitute.
- [Enabled acceptance](../sandbox/.desktop-startup-027/enabled-r2.acceptance.json): all top-level client entries ACTIVE, workspace/conversation/pins present, Better Tasks sidebar and Tasks view activate, no renderer errors, all four served artifacts match candidates.
- [Disabled acceptance](../sandbox/.desktop-startup-027/disabled.acceptance.json): Better Tasks bundle deselected **while all three forks remain installed and actually served**; all top-level client entries ACTIVE, native sidebar/conversation present, pin provider absent, no renderer errors. This directly covers the previously omitted deadlock case.
- Served-code comparison accounts for the inspected runtime's source-map trailer rewrite and appended combo-resource semicolon; it compares all executable bytes, not just revision labels.
- Initial probe defects (assuming a const enum was exported and omitting the runtime's combo separator) were corrected; these were harness assertion failures, not startup failures. Final reports above are PASS.
- Both owned Electron instances closed via ownership-checked CDP. Verified no listeners on 39422/9228 and no owned sandbox Electron process. Real Host 19387 remained PID 42748 throughout. No real profile mutation or restart performed during this follow-up's repair/acceptance.

## Deployment status

**Installed and activated successfully.** Plugin Manager installed the single Better Tasks 0.2.7 root bundle, returned `application: applied`, with no warnings. No real restart was performed or required for this activation. Live Client inspection reports `sidebar.workspaces` (owned by Better Tasks) and `conversation.composer.bar` both `active:true`; the Host row is `include:better-tasks-ui`.

[Installed verification](../releases/0.2.7-desktop-startup/installed-verification.json) confirms all four archive integrities/client hashes and identical wanted/installed locks. Other direct dependencies and selected bundles are unchanged. Settings remain live: observed chat-view and model changes are recorded and never restored from an older backup. Pre-install metadata is retained under this release. Use only the root bundle through Plugin Manager; do not restore the old manual user-layer fork rows or individually install the three native-named packages as bundles.

The release contains local archive dependencies with absolute paths. Retain the entire release directory after installation. It is a machine-local repair, not a portable registry release.

Concurrent real-profile preference edits (chat display, permissions, conversation Enter handling, Cindy transport) were observed and are not to be overwritten with sandbox configuration. Cindy is intentionally disabled only in sandbox acceptance, per the mandatory safety gate.
