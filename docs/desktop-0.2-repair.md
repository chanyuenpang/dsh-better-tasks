# Desktop 0.2 sidebar repair — 2026-09-30

> Historical enabled-state repair only. Subsequent startup failures showed the acceptance was incomplete: disabling Better Tasks with the workspace fork still installed could deadlock core UI. This is superseded for startup/reinstallation safety by the [startup regression follow-up](desktop-0.2-startup-regression.md). Do not redeploy this older two-package candidate.

## Scope and recovered progress

Daily migration session `session-75da3c66-eb96-4d3e-9655-68289276bbc4` last reported that the sidebar shell returned but its workspace/session body remained blank. Its newer region-boundary artifacts were diagnostic candidates, not a completed repair. Existing unrelated working-tree changes were retained.

The target is the installed **DSH Desktop 0.2.0-rc.2**, not the previous Web 0.1.5 profile. The installed desktop manual confirms that the actual shell uses `dsh-app://app/`, preload and IPC boot injection. An ordinary HTTP browser is only an auxiliary diagnostic, not desktop acceptance.

## Confirmed defects and repairs

1. `WorkspaceBrowser` forwarded `useTaskPins` and `setTaskPinned` without destructuring them. Reproduced `ReferenceError: useTaskPins is not defined` on the identical installed composition; the workspace slot abdicated. Fixed the bindings, preserving the existing region boundary, and retained the pin operation Promise so its caller can handle rejection.
2. The sidebar's preference callback was missing from slot injection. Restored `setTaskPreference`.
3. Desktop settings exposes **only volatile Config fields**. Added `extra('volatile', true)` (the exact implementation of the newer Schemastery `.volatile()` helper, also parsable by the retained older build dependency).
4. Settings namespace is `entry.options.id` (`better-tasks-ui`), **not** the Inspect loader path `include:better-tasks-ui`. An initial hypothesis using the latter was rejected by the Electron integration test and corrected from installed Host source.
5. Config forms load asynchronously and `set()` can resolve `false`. Delay legacy preference migration until writable, treat false as rejection, and retain old preference data on rejection. Optional settings never delay the core shell.
6. Explicitly request pinned-session projections through the inspected `sessions.refreshProjections()` API so unopened tasks receive Host-owned Todo/Goal information.

## Exact candidate

Only Better Tasks and the workspace fork are replaced. Layout and user-question packages remain the previously installed Desktop packages; their unrelated staged diagnostic changes are not silently deployed.

- [Better Tasks archive](../releases/0.2.6-desktop-repair-r2/veewo-dsh-better-tasks-0.2.6.tgz): SHA256 `29f5a73c9ad8b43b8f8b61562ffa45ab1b4bc80a5c658f1e76f214287de6d28f`.
- [Workspace archive](../releases/0.2.6-desktop-repair-r2/deepseek-ai-dsh-client-ui-workspace-0.2.0-rc.2.tgz): SHA256 `9cc4f8159efaf38028c184f4a1a52d3b317fef94805325b0d9a30f4f3075052d`.
- [Candidate package fingerprints](../releases/0.2.6-desktop-repair-r2/candidates.json).

These delivery packages have an empty bundle layer. Plugin Manager replacement with `enabled:false` succeeded for Better Tasks, but **not for the native-named workspace fork**: bundle resolution intentionally checks the installation before the profile, finds the shipped non-bundle package and returns `not-bundle`. pnpm had already replaced the package files, while the manager restored the wanted manifest/lock. Do not repeat that operation expecting it to persist the fork record.

After explicit user authorization, only the workspace dependency spec and its wanted-lock path/integrity were repaired to match the already-installed pnpm lock. No runtime source, user composition, bundle selection or unrelated dependency was changed by that metadata repair. The already-existing user-layer fork rows remain the sole composition authority. This is an update to the existing desktop composition, not a standalone fresh-install bundle. No version exemption or install script was used.

## Mandatory startup and desktop checks

Startup command: [desktop-electron-start.ps1](../sandbox/desktop-electron-start.ps1), invoking the actual installed `H:\Program Files\Deepseek\DeepSeek Harness.exe`, not a replacement shell.

- Independent `DSH_HOME`: `sandbox/.desktop-electron-020-r2/home`; profile `desktop`; independent Electron user-data directory, session storage and ledger.
- Candidate archives extracted to the two replacement package directories; all other package resolution and disabled native rows copied from the real composition. `dsh-cindy-host` explicitly disabled.
- Host listened at `http://127.0.0.1:39422/`; desktop CDP bound only to loopback port 9228. The real Host on 19387 was untouched.
- Actual renderer target `dsh-app://app/`, `window.dshDesktop` present, root/sidebar/workspace/conversation activated.
- Native session view → Tasks → reload persisted Tasks → native session view passed with zero captured renderer errors.
- A copied, completed, non-subagent historical session (`session-eeba03f7-f2ab-46ea-a117-01792cee751c`, no active Goal) was pinned **only in the isolated home**. Its real task card rendered with **8/8 Todo**. No model request or real-session mutation was made.
- [Desktop acceptance evidence](../sandbox/.desktop-electron-020-r2/acceptance.json); [nonvisual probe](../sandbox/desktop-electron-probe.mjs). No screenshot, CSS/geometry/pixel measurement or broad visual QA was performed.
- [Regression results](../sandbox/desktop-020-tests.log): **171/171 passed**.
- Both temporary Electron instances, the auxiliary HTTP Host and Edge were stopped. Ports 39421, 39422, 9227 and 9228 were verified absent; no owned sandbox process remained. Real port 19387 still belonged to PID 38104.

## Deployment state

**Completed.** The user chose to restart manually, then confirmed that Better Tasks' basic functionality was restored in the actual Desktop window. Live Client inspection changed `sidebar.workspaces` from `active:false` to **`active:true`**. The agent did not restart the real application.

After the user authorized the narrow metadata repair, [installed verification](../releases/0.2.6-desktop-repair-r2/installed-verification.json) passed: wanted and installed lock files are byte-identical, both archives' SHA512 integrities and installed clients' SHA256 hashes match, unrelated dependency resolutions/snapshots and fork composition are unchanged. Concurrent user changes to model, permissions, Cindy and view preferences were preserved.

[Read-only install verifier](../scripts/verify-desktop-repair-install.mjs) can recheck these invariants without installing, reloading or restarting. Pre-install packages/config and pre-metadata-repair records remain under the release directory. No further restart is required for the metadata correction.
