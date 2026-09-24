# Sandbox-first acceptance

Date: 2026-09-23

## Mandatory startup gate

The exact candidate composition must cold-start in an isolated profile before the real profile may be changed. `AGENTS.md` records this as a project rule.

Sandbox isolation contract:

- dedicated `DSH_HOME`: `G:\Projects\dsh-better-tasks\sandbox\dsh-home`
- custom profile copied from the shipped Web template: `better-tasks-sandbox`
- overlay: `sandbox/cordis.better-tasks.yml`
- `dsh-cindy-host` explicitly disabled
- no reuse of the real Session storage, receipt ledger, or port

Cold-start command:

```powershell
$env:DSH_HOME='G:\Projects\dsh-better-tasks\sandbox\dsh-home'
dsh --profile better-tasks-sandbox --from-default-profile web `
  --patch G:\Projects\dsh-better-tasks\sandbox\cordis.better-tasks.yml `
  --no-open --port 3081
```

The isolated Host reached `http://127.0.0.1:3081/` successfully with a dedicated `DSH_HOME` and Cindy Host disabled. Edge CDP confirmed the root layout, Better Sidebar, native Session/Workspace surface, Tasks tab, collapse rail, and zero browser runtime/console errors. It also opened the native Better Tasks settings section, verified six font choices, independent Todo/Goal/Final switches (`false / false / true`), Auto columns, persisted `14px` across a reload, then restored `13px`. The empty isolated profile intentionally had no real task rows; data-dependent task assertions were covered separately by model/contract tests.

The final settings gate repeated that cold start using the scoped `@veewo/dsh-better-tasks@0.2.0` tgz plus three exact-fork tgz dependencies and `sandbox/cordis.packaged.yml`; no composition row referenced the development checkout. Profile `node_modules` entries were ordinary installed directories rather than links to the source tree. The scoped-package settings persistence probe and core browser smoke produced the same result with zero browser errors.

The `0.2.1` pinned-title candidate repeated the package-mode cold start with the rebuilt Workspace fork. The installed fork contained exactly one `data-dbt-pinned-title-marker` and one `📌` render literal; core native/task surfaces activated with zero browser errors, and port 3081 was removed afterward.

## Automated evidence

- `npm test`: **71/71 passed**.
- `npm run check`: passed.
- Exact fork replay passed for:
  - `@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2`
  - `@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.2`
  - `@deepseek-ai/dsh-client-ui-user-questions@0.1.5-rc.2`
- Workspace fork hash: `215f6b57521c2f7b1c8322efb5df84248f88501f580c8857aedbf8609916d13a`.
- Layout fork hash: `d0bc9cc148d6f9f7f96298f16c18b7b2d86d0ab3e827e8aa424738798b1a4fea`.
- User-question fork hash: `82cac65a09c0a5c39f25a868e1ad531f701730c00c9c0f24496dc4203b8611b7`.

Behavioral evidence includes:

- 528px remains one column; 529px becomes two independent vertical flows.
- At viewport 1600px the ceiling is 840px; at 2000px it is 1000px.
- Responsive narrowing preserves the 1000px preference and widening restores it.
- Whole-card click/drag guards, a Session-matched 14px pinned glyph in a 24px hover-only unpin container, an `aria-hidden` `📌` title prefix only for pinned Session rows, no horizontal overflow, and zero browser errors.
- Pin/Unpin publishes optimistic membership and pending state synchronously while writes remain confirmed-revision CAS operations; queued refresh, concurrent intents, 409 retry, and failed-write rollback have direct tests.
- Durable Final extraction, 4,000-code-point bound, cache validation, configurable per-idle-cycle default, same-cycle manual override persistence, and icon-free full-width detail text.
- Goal defaults to collapsed; Todo, Goal, and Final resolve independent configurable defaults, preserve manual overrides for the same lifecycle, and clear only their own override when a new lifecycle begins.
- The Host-backed Better Tasks settings section configures 11–16px detail text (13px default) and Auto/Single/Double columns; optimistic UI changes roll back on rejected writes.
- Restored current Sessions are opened during cold navigation so Goal actions have a binding without requiring a preliminary chat message.
- Every New Session route uses the single `uiWorkspace.onSessionCreated` auto-pin seam.
- `questionSurface` is optional to Better Tasks, preventing service-wait startup deadlocks.

## Real profile and ledger recovery

The real patch disables shipped `ui-layout`, `ui-sidebar`, `ui-workspace`, and `ui-user-questions`, then mounts exactly one installed package owner for each plus `better-tasks-sidebar`; it contains no Better Tasks development-checkout path.

A later `LEDGER_LOCKED` was traced to `${DSH_HOME:-$HOME/.dsh}/assistant-session-bridge/receipts/operation.lock`, owned by dead PID `62372`. After confirming the PID was absent, only that stale lock was removed. Three confirmed stale test profiles on ports 3095–3097 were stopped. `session_manage projects` and `session_manage list` then succeeded, proving the bridge ledger was available again. Port 3081 had no listener; only real port 3080 remained.

The package-mode real cold start completed on port 3080 and a later live profile refresh is serving as PID `57740`. Real Edge opened the native Better Tasks settings section, verified 13px and `Todo=false / Goal=false / Final=true / Auto`, toggled Todo to true while Goal remained false across reload, persisted 14px, restored Todo=false and 13px, and recorded zero browser errors. The preceding optimistic Pin/Unpin regression held Host POSTs open while DOM feedback completed in 27.5–28.7ms initially and 5.3–7.1ms warm; membership was restored after every measurement. Integrated appearance, full-width Final, disabled non-ready projections, whole-card guards, independent columns, and zero horizontal overflow remain covered by the broader regression.

## Failures caught and rules added

1. A hard `questionSurface` dependency was added before its provider existed, causing a service-wait chain that prevented core UI activation. Better Tasks now performs optional lookup with native Composer fallback.
2. A sandbox reused real DSH storage and competed for the ledger. Sandboxes now require a dedicated `DSH_HOME` and disabled Cindy Host.
3. Final auto-open originally used component-memory transition state, so a tab remount reopened a manually collapsed Final. The idle-cycle marker is now persisted by `sessionId → updatedAt`.
4. Final content originally lived only in React memory. The bounded safe projection is now cached in browser storage and invalidated only when the Session `updatedAt` changes.
5. The first settings browser probe treated the injected external store as a raw `hooks` prop, but Slots materializes it as `useTaskPreferences`. The cold-started core stayed healthy, while opening the page surfaced the render failure; the component now consumes the generated hook prop, and the second cold-start plus persistence probe passed with zero browser errors.
6. The first scoped npm candidate kept the old unscoped browser loader ID, so DSH correctly rejected `@veewo/dsh-better-tasks` as “loaded without registering.” The builder and bundle smoke test now require the scoped loader ID; a clean reinstall and cold start then passed.
