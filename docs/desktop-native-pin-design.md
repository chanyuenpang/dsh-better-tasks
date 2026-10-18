# Native Pin as task-view membership

## Confirmed scope

The task view is the card presentation of officially pinned Sessions. The user confirmed retaining automatic pinning for newly created/reused Sessions. The existing official project-local pinned block (or pinned partition in flat mode) remains untouched; no new global pinned section or custom native-list ordering is needed. The currently accepted input UI/UX is out of scope.

Official Pin controls already exist in the workspace fork. The extra Better Tasks button writes a different collection, explaining why it did not trigger official pin ordering. Remove that extra control, custom glyph, title emoji and optional bridge, retaining the official row/menu controls, indicator and sorting code.

## Ownership and interface contract

- `workspaceRegistry.pinnedSessionIds` is the sole durable membership authority. Official archive atomically removes a pin. A missing catalog row is not proof of deletion; never unpin merely because a Session is absent from the current list.
- Client `workspaces.list` provides native membership and live cross-window follow updates. Respect its pending/ready and reconnect semantics; do not clear retained data on carrier loss. Do not create custom optimistic membership or write the native store.
- Auto-pin and task-card Unpin use public `uiWorkspace.pinSession/unpinSession`, also preserving native sidebar pin-fronting policy. Keep the accepted `onSessionCreated` hook, including blank reuse; official Host pin accepts a known, nonarchived blank Session.
- A separate version-1 Better Tasks order/migration domain owns only rank, revision and migration bookkeeping. The legacy `better_tasks_pin_queue` domain stays unchanged and readable for rollback; do not add flags/tables that old schema parsing can erase.
- Keep the existing `/api/better-tasks/pins` response `queue:{schemaVersion:1,revision,sessionIds,updatedAt}` as a compatibility projection: rank intersected with current official membership, then unseen official pins. Rank entries can never resurrect unpinned members. Optional top-level `warnings:string[]` communicates migration/storage issues.
- POST `move` is CAS over rank; conflict supplies current projected queue. If old pin/unpin/pin-created requests are accepted for compatibility, they must delegate only to the official registry, never mutate a second membership collection.
- Final-message authorization reads the native pin set, not the legacy queue or rank list.
- Native follow drives immediate membership. Native membership changes and existing focus refresh obtain current task rank; no new SSE or private Remote protocol is required for this scope.

## Migration boundary

Import existing valid legacy tasks once without deleting the legacy data. Preserve its manual rank, append already-native-only members deterministically, and exclude archived Sessions without unarchiving them. Use official pin validation for unknown/archive errors; the catalog omits some cold headers, so catalog absence must not destructively prune a legacy task.

Migration must not block core startup; trigger lazily through the feature API. Persist separate one-time/per-entry attempt bookkeeping so a completed or uncertain interrupted migration does not repeatedly re-pin a Session that the user subsequently unpinned. Already-native seed members are not import targets. Observe native domain-change payloads to suppress pending imports touched externally before enqueue. Failures remain explicit warnings with the original legacy data available for recovery, not compensating unpins.

The official registry serializes operations but exposes no public cross-domain transaction, pin CAS, cancellation or actor-tagged event. Once an import has been enqueued, arbitrary concurrent native operations follow ordinary FIFO/last-writer semantics; do not claim stronger atomic migration guarantees or add a Host fork/private transaction to simulate them.

`domain/changed` occurs before the registry assigns its private current-state cache. Event reconciliation must consume the payload value, not synchronously reread the getter at that point.

## Preservation and verification

Only the main package and workspace fork need changes. Reuse the accepted layout/questions/input fork archives. Preserve all activity filters, full hidden-id order accounts, project appearances, main-view selection, Session lifecycle and input surfaces.

Tests must cover native follow and reconnect, ack-only membership, failed/concurrent operations, automatic blank pin, rank/membership independence, one-time migration and rollback-safe storage, archive/unknown handling, absence of duplicate controls, and unchanged native grouped/flat pin partitions. Cold-start the exact candidate in isolated installed Electron with Cindy disabled, clean it up, and immediately recheck unrelated dependencies before real installation. No real test prompts, automatic real restart, screenshots or geometry checks.

## Official icons and explicitly authorized system animation preference

Both task cards and the workspace fork already used official `StateDot` for ongoing activity. Its official CSS disables animations under reduced motion. A read-only Win32 query confirmed Windows client-area animations were disabled. The user explicitly requested changing the SYSTEM preference, superseding the interim local-override idea: `SPI_SETCLIENTAREAANIMATION` enabled it, persisted and broadcast the setting; a second query confirmed false → true. Other Windows settings were untouched. See [preference evidence](<sandbox/system-animation-preference-20261001-032052.json>). No local forced-animation rule or modified StateDot is shipped, and no renderer geometry/animation measurements were made.

The task panel's approximate migration glyphs were a separate plugin issue. Replace them with verified SDK Regular exports: GoalOutlineRegular, ChecklistOutlineRegular, SparkleRegular, ChevronRight/DownOutlineRegular, PanelLeftOutlineRegular, PinFillRegular; use FolderCloseRegular only as the missing custom-project-icon fallback. Keep user-selected project icons and the accepted input controls unchanged. Final is a BT-specific disclosure using the official Sparkle glyph, not a claimed copy of an official Final widget.

Todo completed/in_progress/pending map exactly to native StateDot done/ongoing/idle with default dot appearance and size, inside the official 16px glyph slot and localized accessible status label. Do not substitute a check, clock or step circle. Native Markdown copy confirmation remains a check and Final retry remains text.

Implementation checks: main bundle and workspace-only Client build pass, changed workspace declarations emit cleanly, strict native module-edge comparison passes, and the full regression suite is **334/334**. Input/layout/questions artifacts must remain byte-identical during release staging.
