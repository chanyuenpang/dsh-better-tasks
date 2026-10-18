# Desktop 0.2.9 input-surface adaptation

## Status

Installed into the real Desktop profile through Plugin Manager on 2026-09-30. Application result: **restart-required**. No real Desktop restart was performed by the agent. The user subsequently confirmed the functionality works, but rejected the changed presentation and requested restoration of the original compact UI/UX with a unified plus menu; that presentation follow-up is tracked separately. This is the native 0.2 input adaptation requested by the user, not a handoff into the main composer.

## Scope

- Ordinary messages, skill insertion, command selection, leading arguments and parameter popups use independent native input surfaces.
- Each card owns its editor/draft/menu/popup and an actual retained Session generation, including unopened tasks. Native main input is not borrowed.
- First expansion acquires a surface. Folding keeps the draft; final disposal waits for in-flight operations and late error restoration.
- Goal recovery happens only after ordinary-message acceptance, reads current CAS/activation, and never converts an accepted prompt into a retry.
- Text/skill/command only in this iteration. `/file` is unavailable in the card; it cannot open the main composer's attachment picker.
- Original layout/workspace/questions archives remain byte-identical to accepted 0.2.7, including the 0.2.8 task-selection logic in the main plugin.
- Three new ordinary native-package dependencies override input-trigger/commands/conversation through profile package resolution. Their existing native rows, ids and configuration are preserved; they are not separately installed bundles.
- The installed application checkout and user settings were not rewritten.

## Evidence

- [Full regression log](<sandbox/desktop-input-tests.log>): **253/253 passed**.
- Three Client bundles compile; strict AST module-edge comparison matches vendored official 0.2.0-rc.2 artifacts. Changed public declarations regenerate without errors; source patches are recorded.
- [Cold-start acceptance](<sandbox/.desktop-input-029/enabled.acceptance.json>): all Client entries ACTIVE, core layout/sidebar/Session/Workspace/conversation active, no renderer errors; all seven served executable hashes match the exact installed candidates.
- [Focused surface acceptance](<sandbox/.desktop-input-029/input-surface.acceptance.json>): initially unretained Session, two independent native editors, live skill catalog insertion, client command plus parameter selection, unchanged other draft/native input, and zero references after disposal.
- Ordinary-message integration used an explicit sandbox-only sink after native adjudication/serialization. It was **not** a real Host/model message. No real model requests, screenshots or geometry checks were performed.
- [Cleanup acceptance](<sandbox/.desktop-input-029/cleanup.acceptance.json>): ports 39422/9228 and owned Electron processes gone before real installation.
- [Installed verification](<releases/0.2.9-desktop-input/installed-verification.json>): archive/client hashes, all lock integrities, wanted/installed locks agree; unrelated direct dependencies and bundle selection preserved; no changed user configuration rows.
- [Dependency-graph verification](<releases/0.2.9-desktop-input/dependency-graph-verification.json>): all 211 package resolutions and snapshots, settings and importers exactly match the cold-started graph after resolving each profile's relative tarball paths.

Sandbox command:

```powershell
& .\sandbox\desktop-startup-start.ps1 -Sandbox .\sandbox\.desktop-input-029 -RunId enabled -Mode enabled
node sandbox/desktop-startup-probe.mjs sandbox/.desktop-input-029 enabled enabled
node sandbox/desktop-input-surface-probe.mjs sandbox/.desktop-input-029
```

The installed Electron executable was used with independent `DSH_HOME`, profile, Session/ledger storage and Electron user-data. Host URL: `http://127.0.0.1:39422`; renderer: `dsh-app://app/`; Cindy Host disabled. The real profile remained at port 19387 and was not restarted.

## Immutable candidate

[Candidate inventory](<releases/0.2.9-desktop-input/candidates.json>) records all seven archives.

- Main version: `@veewo/dsh-better-tasks@0.2.9`.
- Main archive SHA256: `b01ecb208cf1887de8744587d8864ab6216f5fadc58d5d1412c10eeafa1c102b`.
- Main Client SHA256: `a4840d273fc242ec157674f3f575063d3e06183fe61c118814e64da89cfde7d9`.
- Normalized full dependency graph SHA256: `6efbe0af622b30a76c9ca76640c449e3327467105257b6cff88b80423634f69c`.

Keep both this release directory and the reused 0.2.7 archive directory: installed file dependencies refer to them. Rollback is reinstalling the retained 0.2.8 bundle through Plugin Manager, then a user-authorized Desktop restart; do not overwrite live user preferences with an old backup.
