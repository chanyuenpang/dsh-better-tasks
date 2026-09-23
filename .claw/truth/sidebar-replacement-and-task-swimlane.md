# Sidebar replacement and pinned-task swimlane

<!-- state: current -->
## Current behavior

`dsh-better-tasks` is a regular buildable Host/Client Cordis package. Its client registers `BetterSidebarRoot` as the sole `sidebar` root, while its Host owns the pinned-task queue, project appearance compatibility domain, and safe Final-message projection.

The integration composition disables the shipped `ui-sidebar` root but keeps native child registrants enabled. `BetterSidebarRoot` declares and renders the six root-scoped compatibility seats:

- `sidebar.brand.mark`
- `sidebar.brand.name`
- `sidebar.panellist`
- `sidebar.workspaces`
- `sidebar.settings`
- `sidebar.footer.action`

The project uses exact, project-local compatibility forks of `@deepseek-ai/dsh-client-ui-workspace`, `@deepseek-ai/dsh-client-ui-layout`, and `@deepseek-ai/dsh-client-ui-user-questions` at the `0.1.5-rc.2` baseline. Their differences must remain auditable and replayable; the DSH installation and shipped preset are not edited.

### Task ownership and queue semantics

The Host storage domain `better_tasks_pin_queue` is the sole owner of task membership and order. Its versioned record contains a monotonic revision, ordered unique Session ids, and an update timestamp. Mutations are serialized through the storage table and use revision compare-and-swap; a conflict returns the current queue rather than silently accepting stale client state.

Normal pinning rejects missing, blank, archived, and subagent Sessions. The creation-only `pin-created` action permits a retained blank Session so every successful create-or-reuse path can be pinned before its first message, while still rejecting missing, archived, and subagent Sessions. Repeating the action is idempotent. Invalid retained entries are pruned explicitly.

The task view renders the Host order directly and never re-sorts by `updatedAt`. Every `uiWorkspace` create-or-reuse entry reports through `onSessionCreated`; Better Tasks installs one lifecycle-bound handler that calls `pin-created`. Pin failure does not roll back or close the created Session and is surfaced to the user.

### Workspace and task presentation

The `ui-workspace` fork preserves native search, grouping, ordering, drag/drop, rename, fork, archive, Workspace management, directory flow, and conversation-picker behavior while adding:

- `all`, `1d`, `3d`, `7d`, and `14d` activity filtering over the actual Session tree;
- one Pin glyph per eligible Session row, with pressed state, tooltip, keyboard, and failure semantics;
- the shared `onSessionCreated` lifecycle seam used by every create-or-reuse path.

Pinned task cards display the project identity, localized relative Session time, official running `StateDot`, and whole-card `block > running > idle` background semantics without visible status text. Status remains available through accessible labels and titles. The whole card selects and drags; internal controls opt out of selection and drag. The unpin control is compact and only becomes visible on card hover or focus.

Goal and Todo are read from the existing Session projection values and retain `unknown`, `none`, and ready-value distinctions. Their toggles are disabled when no ready value can be expanded. The card never creates a second Goal or Todo owner.

Idle cards expose Final on demand. The Host endpoint accepts pinned Sessions only and returns the latest ended, current-surface assistant text, truncated safely to 4000 Unicode code points. The client caches the safe payload by Session freshness and persists an idle-cycle marker: Final opens on first idle presentation and on each later transition into a new idle cycle, while a manual close remains respected for the rest of that cycle.

Pending questions use the exact `ui-user-questions` fork's shared `questionSurface`, draft state, and one-way settlement gate. Better Tasks performs an optional service lookup; if the surface is unavailable, the native conversation composer remains the canonical fallback and sidebar, Session, and Workspace activation must not wait.

Project icon and color remain in the existing `workspace_appearance` domain name, version, and table schema. Better Tasks now mounts that owner and the existing `/api/project-appearance` contract itself, preserving prior data and cleaning entries for deleted Workspaces.

### Layout behavior

The exact `ui-layout` fork remains the sole sidebar-width owner. It persists the last expanded width with a 264px minimum, 280px default, and dynamic `max(840px, 50vw)` ceiling. Better Tasks receives the actual width and switches to two independent vertical card flows only when the width is strictly greater than 528px; it does not maintain another width preference.

### Implementation anchors

- `src/index.js`, `src/pin-model.mjs`, and `src/pin-client.mjs`: Host queue domain, eligibility, pruning, revision-CAS API, and client projection.
- `src/final-message.mjs`: pinned-only Final extraction and 4000-code-point bound.
- `src/project-appearance.mjs`: compatible `workspace_appearance` owner and HTTP contract.
- `src/client.js`: sidebar root, pinned cards, projection availability, Final cache and idle-cycle state, optional question surface, and auto-pin registration.
- `forks/ui-workspace`: native-parity Session tree filtering, row Pin action, and session-created lifecycle seam.
- `forks/ui-layout`: persistent width owner and dynamic width ceiling.
- `forks/ui-user-questions`: shared official question renderer, draft state, and single-settlement gate.

### Constraints and pitfalls

Child-slot ownership is per registered root entry. Keeping the shipped root active while redeclaring its children creates duplicate declarations; priority-shadowing does not authorize one root to render another root's children. The shipped `ui-sidebar` root and Better Sidebar root therefore cannot be active together.

Do not use DOM injection, fork the shipped installation in place, add a second pin/order or width truth, duplicate Goal/Todo/Session state, or hard-inject the optional question surface. Host and Client effects, routes, services, listeners, styles, and slot registrations must remain lifecycle-disposable.

A sandbox must use the candidate composition with its own `DSH_HOME`, profile, Session storage, and ledger, and must disable Cindy Host. Reusing live storage can produce `LEDGER_LOCKED`; a hard optional-feature dependency can hold the root layout, sidebar, Session, Workspace, and conversation surfaces in a Cordis wait chain.

### Verification and recovery

Before any real-profile installation, replay the three fork patches/provenance checks, run package tests and checks, then cold-start the exact candidate composition in an isolated sandbox and verify Host listening, browser-shell activation, native and task views, Session/Workspace/conversation surfaces, pin and reorder behavior, Final, question fallback, width restoration, and zero startup/browser errors.

The completed pinned-task release passed 58/58 automated tests, package checks, all three provenance replays, an isolated cold start, and live Edge regression on `:3080` with no recorded Host or browser errors.

Rollback is composition-based: restore the last known-startable composition, re-enable the shipped packages that the local rows replace, restart `dsh web`, and refresh with the new token URL. Do not mutate Session, Workspace, Goal, Todo, pin-queue, or appearance data merely to roll back UI code.

<!-- state: history -->
## Evolution history

<!-- dated: 2026-09-23 -->
### Replaced recent-Session model

The first accepted release had no Host-owned task state. It derived at most ten recent Sessions in the browser after activity filtering and stored only view preferences locally. That model remains relevant for rollback and explains why earlier code and documentation describe the Host as state-free. It was replaced by the revision-CAS pin queue and manually ordered pinned-task view after the product required durable cross-browser membership, row-level Pin actions, and stable drag ordering.
