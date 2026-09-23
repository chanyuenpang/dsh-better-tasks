# ADR: Replace the native sidebar root with compatible local forks and Host-owned task state

## Context

The project must own the sidebar shell and provide a durable pinned-task workflow while preserving the native Workspace Browser, Settings, branding, global panels, footer actions, expanded layout, collapsed rail, Session lifecycle, and conversation interactions.

Cordis slot children belong to the root registration entry that declares them. A replacement root cannot safely render the shipped root's children merely by winning single-slot priority. The shipped workspace, layout, and question packages also expose no stable public extension points for the required Session-tree filter, row Pin action, shared create hook, expanded width contract, or task-card question surface.

Pin membership and manual order must survive refresh, restart, and another browser. Goal, Todo, Session, Workspace, sidebar width, pending questions, and project appearance already have owners whose business semantics must not be duplicated. Any shell-wide composition change must cold-start safely before it is installed into the real Web profile.

## Decision

Deliver the feature as the regular project-local `dsh-better-tasks` Host/Client Cordis package.

At composition time, disable the shipped `ui-sidebar` root and register `BetterSidebarRoot` as the sole `sidebar` root. The replacement entry declares the same six root-scoped child seats for brand mark, brand name, panel list, Workspace Browser, Settings, and footer action, and renders existing registrants through those seats.

Use exact, project-local compatibility forks of `@deepseek-ai/dsh-client-ui-workspace`, `@deepseek-ai/dsh-client-ui-layout`, and `@deepseek-ai/dsh-client-ui-user-questions` at the `0.1.5-rc.2` baseline. Keep fork provenance and patches replayable. Do not modify the DSH installation or shipped preset.

Assign ownership as follows:

- Better Tasks Host owns one versioned `better_tasks_pin_queue` record and exposes revision-CAS pin, creation-pin, unpin, and reorder mutations. The ordered Session-id list is the sole task-membership and order truth.
- The workspace fork owns native Session-tree presentation additions: activity filtering, row Pin state, and one `onSessionCreated` lifecycle seam covering every create-or-reuse entry.
- The layout fork remains the only sidebar-width owner and persists a 264px minimum, 280px default, and `max(840px, 50vw)` ceiling.
- Session, Workspace, Goal, Todo, and pending-interaction semantics remain with their native owners. Better Tasks only reads their projections.
- The user-question fork exposes the official renderer, shared draft state, and single-settlement gate as `questionSurface`. Better Tasks looks it up optionally; missing support falls back to the native Composer rather than blocking core UI activation.
- Better Tasks adopts the existing `workspace_appearance` domain name, version, table schema, and HTTP contract so prior data remains valid without a second provider.
- Final is a bounded read projection, not a new transcript owner: the Host returns only the latest ended current-surface assistant text for a pinned Session, limited to 4000 Unicode code points; the client may cache that safe payload and idle-cycle expansion state.

Require the exact candidate composition to cold-start in an isolated sandbox with separate `DSH_HOME`, profile, Session storage, and ledger and with Cindy Host disabled. Host listening, browser-shell activation, core Session/Workspace/conversation surfaces, and zero startup errors take precedence over optional feature completeness. Only after that gate passes may the real composition be changed or `dsh web` restarted.

## Alternatives

- **Priority-shadow the shipped sidebar root:** rejected because a winning root is not authorized to render child slots declared by another entry.
- **Keep both sidebar roots and redeclare child seats:** rejected because duplicate declarations fail activation.
- **Use only a task-settings picker and leave the Workspace Browser untouched:** rejected because the selected product behavior requires actual Session-tree filtering and one row-level Pin entry.
- **Inject Pin/filter controls into native DOM:** rejected because Session identity, React reconciliation, drag behavior, keyboard behavior, styles, and lifecycle are not stable DOM contracts.
- **Copy Workspace Browser, layout, or question business logic into Better Tasks:** rejected because it creates competing owners and excessive parity risk. Exact, narrow forks retain the upstream owners and make differences auditable.
- **Persist task membership or order in browser storage:** rejected because it cannot provide global cross-browser truth or safe concurrent mutation.
- **Hard-inject `questionSurface`:** rejected because an unfinished optional provider can hold the root layout and all dependent UI in a Cordis service-wait chain.
- **Store Final as a second durable transcript:** rejected because Session history is already canonical; Final is a bounded on-demand projection.
- **Patch the DSH installation or shipped preset:** rejected because upgrades overwrite those changes and rollback becomes unsafe.

## Consequences

The project can provide a native-feeling pinned-task sidebar while preserving existing child registrants and business owners. Host revision-CAS makes stale writes explicit and manual ordering durable. The shared create hook gives all creation paths one idempotent auto-pin rule without rolling back a successfully created Session when pinning fails.

The design deliberately accepts maintenance cost: three exact forks must be compared with their upstream version, rebuilt, and regression-tested before an upgrade. Composition is stricter because shipped and local owners for the same root/package cannot be active together. The local package now owns durable pin and appearance domains, so rollback must preserve their data even when UI rows are restored.

Optional integrations must remain optional until their providers pass the same candidate-composition startup gate. A missing question surface degrades only task-card answering; it must never block the sidebar, Session, Workspace, or conversation surfaces.

Every real-profile change requires the sandbox-first gate and a composition rollback plan. The sandbox must never share live ledger or storage state. If live startup fails, restore the last known-startable composition before attempting feature repair.

<!-- state: history -->
## Decision evolution

<!-- dated: 2026-09-23 -->
### Corrected root-slot ownership assumption

The initial design considered retaining the shipped root and relying on registration priority. Isolated runtime testing showed both failure modes: equal-root registration failed loudly, and redeclaring children alongside the shipped root produced duplicate declarations. The accepted design therefore moved child-seat declaration and rendering into the sole replacement root while leaving native child registrants active.

<!-- dated: 2026-09-23 -->
### Expanded from a read-only recent view to a durable pinned workflow

The first accepted sidebar release kept the Host free of business state and derived up to ten recent Sessions in the browser. Product decisions later required row-level Pin, persistent manual ordering, wider layout behavior, card-level pending questions, durable Final presentation, and auto-pin across every creation path. The accepted design expanded to narrow exact forks and a Host-owned CAS queue rather than introducing DOM injection, local-only state, or copied native business logic.
