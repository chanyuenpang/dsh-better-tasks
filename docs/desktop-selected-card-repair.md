# Desktop task-card selection — 0.2.8

## Root cause

The existing visual enhancement was present, including the selected-card border and slightly stronger state background. The projection still used `list.current`, removed from the Desktop 0.2 session catalog. Consequently `task.current` never became true. This was a state-contract migration omission, not missing CSS.

The official 0.2 workspace browser identifies the main session through `SessionSummary.retainedBy.mainView > 0` and suppresses selection while `usePanelInfo(info => info.activePanelId !== null)` is true. Running background agents are a separate status, not the selected session.

## Repair

- [Task model](../src/task-model.mjs): `currentTaskSessionId` follows the 0.2 retention contract, with `list.current` fallback only for genuinely legacy snapshots. No fallback to stale legacy selection when retention data exists.
- [Sidebar client](../src/client.js): passes the standard `usePanelInfo` hook through SidebarRegion to TaskSwimlane, which feeds the panel state into the projection.
- CSS unchanged. No new service injection or fork rebuild.
- [Selection regressions](../test/task-current-session.test.mjs): main-view switching, background-running distinction, non-conversation panels, no main view, legacy compatibility and the complete hook/attribute path.
- [Full test result](../sandbox/desktop-selected-card-tests.log): **199/199 PASS**. The old contract assertion that enforced `list.current` was updated; visual-style assertions remain intact.

## Acceptance

[Startup acceptance](../sandbox/.desktop-selection-028/selection.acceptance.json) verifies the actual installed Electron, app protocol/preload, all client entries active, and exact served candidate bytes. [Selection-state acceptance](../sandbox/.desktop-selection-028/selection-state.acceptance.json) verifies `false → true → false on another panel → true on return` using one copied completed session. It remained idle, no model request was sent, and no visual/geometry measurements were performed.

Sandbox had independent home/profile/sessions/ledger and Electron user-data; Cindy disabled. It was closed and both owned ports/processes verified absent before installation.

## Deployment

Plugin Manager installed **Better Tasks 0.2.8**, changing only the main package (`Packages: +1`). The three fork archives are the exact immutable 0.2.7 artifacts, not rebuilt copies; their hashes and the client/archive identities are in [candidate fingerprints](../releases/0.2.8-desktop-selection/candidates.json).

**Completed: user restarted Desktop and confirmed the feature works normally.** Installation originally returned `restart-required` because it replaced an already-loaded package; that pending restart has now been performed by the user, not the agent. Installation-time records and hashes remain in [deployment verification](../releases/0.2.8-desktop-selection/installed-verification.json); its pending-restart flag is a historical snapshot, superseded by this post-restart user acceptance.

Keep both release directories: 0.2.8 intentionally references the three immutable local archives from 0.2.7. Pre-install metadata retains the previous main-package spec for rollback.
