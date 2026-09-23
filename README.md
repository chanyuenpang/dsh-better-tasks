# dsh-better-tasks

A compositional DSH sidebar replacement with a Host-global pinned-task queue and version-locked compatibility forks of the native Workspace Browser, layout frame, and user-question surface.

## Behavior

- `BetterSidebarRoot` replaces only the shipped `ui-sidebar` root while preserving its six child-slot contracts.
- A project-local fork of `@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` remains the single `uiWorkspace` owner and the single registrant for `sidebar.workspaces` and `conversation.hero.workspace`. On cold startup it opens the restored current Session binding so Goal actions work before any new chat message.
- A project-local exact fork of `@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.2` remains the single `layout`/root owner. It persists the last positive sidebar width under `dsh-better-tasks.layout.sidebar-width.v1`, clamps it to `264px..max(840px, 50vw)`, and preserves it across collapse and refresh.
- The Session view keeps native search, grouping, ordering, Workspace actions, and directory flows. Its existing view-options menu adds `all / 1d / 3d / 7d / 14d` activity filtering.
- Every ordinary grouped/flat Session row uses one Pin glyph with `aria-pressed` off/on states. There is no task-list add button or settings picker.
- The Host persists one revision-CAS pin queue in the `better_tasks_pin_queue` storage domain. Membership and manual order survive refreshes, restarts, and browsers. The Client projects Pin/Unpin intents immediately while Host writes remain serialized against confirmed revisions; failures roll back and 409 conflicts still retry once. Every New Session route—Sessions/Tasks tab, top/rail action, or Workspace group—uses one `uiWorkspace` lifecycle hook and the dedicated idempotent `pin-created` command.
- The same Host package owns the existing `workspace_appearance` domain and `/api/project-appearance` contract, including its 191-icon catalog. Existing icon/color records remain in place and no separate project-appearance plugin is required.
- The Tasks view renders that exact queue order. Cards are whole-card drag surfaces and selection targets without a grab cursor, with a hover-only top-right unpin action, native `relativeTime`, the unchanged native running `StateDot`, persistent read-only Goal/Todo disclosures, and `block > running > idle` card backgrounds. Empty or completed Goal projections and unavailable Todo projections are disabled. Goal and Todo default to collapsed and never affect one another. Final defaults to expanded for each new idle cycle; manual choices survive tab switches and refreshes for the same lifecycle. Its bounded safe payload and cycle marker are cached, and the icon-free detail uses the full card width.
- The native Settings panel has a Better Tasks section backed by the Host `better-tasks-ui` settings namespace. It configures 11–16px projection detail text, independent Todo/Goal/Final default expansion, and `auto / single / double` task columns. Auto preserves the strict `>528px` boundary; both two-column modes use independent index-interleaved vertical flows.

## Package

The Host/Client package is published publicly as [`@veewo/dsh-better-tasks`](https://www.npmjs.com/package/@veewo/dsh-better-tasks):

```bash
npm install @veewo/dsh-better-tasks
```

The complete sidebar composition also requires the three version-locked compatibility forks. Use the immutable assets and package-name composition described in [`docs/release.md`](docs/release.md); do not point a real DSH Profile at the development checkout.

## Commands

```bash
npm run build       # verifies/materializes all exact forks, then builds the sidebar bundle
npm test            # complete unit and contract suite
npm run check       # build plus syntax checks
```

Fork provenance is locked in `provenance/ui-workspace.lock.json`, `provenance/ui-layout.lock.json`, and `provenance/ui-user-questions.lock.json`; reviewed deltas are in the matching `patches/` directories. Sandbox and real-GUI evidence is recorded in `sandbox/acceptance.md`, with rollback steps in `docs/rollback.md`.

## Architecture

The base contract and final interaction revision are recorded under `.claw/tasks/2026-09-23/钉选任务队列与侧栏交互优化/feature-architecture/`, including `2026-09-23-1149-任务卡交互与侧栏宽度修订.md`.
