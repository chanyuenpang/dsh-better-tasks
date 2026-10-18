# Desktop 0.2.11 — official Pin, native icons and system animation

## Current status

Installed through Plugin Manager. Application result: **restart-required**. The agent has not restarted the real Desktop. User restart and product acceptance remain pending; legacy-task import is lazy at the first feature API request after the new Host code activates.

The Windows client-area animation preference was separately changed from disabled to enabled at the user's explicit request, persisted and broadcast. Other system preferences were not changed. [Read-back evidence](<sandbox/system-animation-preference-20261001-032052.json>). No local forced-animation stylesheet is shipped; native running/Todo animations remain official.

## Delivered

- Task cards derive membership from the official Workspace pin set, not a second task-pin collection.
- The existing official project-local/flat pinned presentation is preserved. Extra BT row button, custom pin SVG, title emoji, bridge and hook props were removed.
- New/reused Session flows retain automatic official Pin. Task unpin goes through the public native UI action; it does not navigate or stop the Session.
- Task rank remains separate metadata. Native follow updates membership across windows; rank refreshes on membership changes/focus and retains CAS protection.
- A new independent v1 order/migration domain leaves legacy queue storage unchanged. Bounded lazy migration seals a journal before importing; partial/interrupted attempts warn and do not continually resurrect native-unpinned legacy ids. Public-API atomicity limits are documented in [design](<docs/desktop-native-pin-design.md>).
- Goal/Todo/Final/disclosure/sidebar/unpin glyphs use verified official Regular exports. Todo completed/in-progress/pending use native done/ongoing/idle StateDot with the official fixed glyph slot. User project icons and accepted input UI/UX remain unchanged.

## Validation

- [Full regression log](<sandbox/desktop-native-pin-tests.log>): **334/334 PASS**.
- Workspace-only runtime build, strict official module-edge gate, source stamping and ten changed/added declarations passed. Its source patch was regenerated. Only main/workspace packages changed; five accepted fork archives were reused byte-for-byte.
- [Installed-Electron cold-start report](<sandbox/.desktop-native-pin-0211/enabled.acceptance.json>): all Client entries ACTIVE, core layout/sidebar/Session/Workspace/conversation active, no renderer errors, seven candidate hashes matched; actual runtime native icon exports were verified.
- [Logical integration report](<sandbox/.desktop-native-pin-0211/native-pin.acceptance.json>): official API Pin/Unpin mirrors task membership; task rank does not mutate native pin order; archive removes membership, unarchive does not re-pin; actual New Session UI flow still auto-pins. Only empty sandbox Sessions were created, with no model requests or visual measurements.
- [Sandbox cleanup](<sandbox/.desktop-native-pin-0211/cleanup.acceptance.json>): owned processes and ports 39422/9228 gone before installation.
- [Immediate preinstall consistency](<releases/0.2.11-desktop-native-pin/preinstall-consistency.json>): unrelated direct dependencies, retained package graph and composition unchanged since validation; live user configuration was not overwritten.
- [Installed verification](<releases/0.2.11-desktop-native-pin/installed-verification.json>): exact archive/client hashes and lock integrities; wanted and installed lockfiles match; unrelated dependencies/bundles and user settings preserved.
- [Full graph verification](<releases/0.2.11-desktop-native-pin/dependency-graph-verification.json>): all 211 resolutions/snapshots, settings and importers match the cold-started graph after resolving profile-relative tarball paths.

Sandbox used the installed Electron executable, `dsh-app://app/`, Host `http://127.0.0.1:39422`, independent home/profile/Session/ledger/Electron user-data, and disabled Cindy Host. No real test prompts, screenshots, computed geometry checks or automated real restart.

## Artifact identity

[Candidate inventory](<releases/0.2.11-desktop-native-pin/candidates.json>):

- Main archive SHA256: `9c2c781e6ebf3f098343ff23223d3f41efdf990a36c2bada22806425c360a615`.
- Main Client SHA256: `c20fe37884f8637d6de602e9dd04eea8f009711ba9ba2fa91f6dd13c0068b171`.
- Workspace archive SHA256: `616f3247abebbc8a1b174cc27737ec5aae1ac1e40418a340b0d296ff23328fbd`.
- Workspace Client SHA256: `a4c96a852d03d7c9775d96b2552a1e74714abfe4f5118253660698ffb133132c`.
- Normalized dependency graph SHA256: `a7b989a7c5b4d37bce2e19696bb3aae0fa7fb0d1c18a2650b994f45e5c36498f`.

Keep release directories referenced by file dependencies. Rollback uses the accepted 0.2.10 bundle through Plugin Manager and a user-controlled restart; never restore an old whole profile over concurrent user settings. Legacy task data remains available, but its old rollback UI is not the new native membership authority.
