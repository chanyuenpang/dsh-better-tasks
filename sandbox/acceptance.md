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

The final gate repeated that cold start using only four installed tgz dependencies and `sandbox/cordis.packaged.yml`; no composition row referenced the development checkout. Profile `node_modules` entries were ordinary installed directories rather than links to the source tree. The packaged settings persistence probe and core browser smoke produced the same result with zero browser errors, and port 3081 was removed afterward.

## Automated evidence

- `npm test`: **71/71 passed**.
- `npm run check`: passed.
- Exact fork replay passed for:
  - `@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2`
  - `@deepseek-ai/dsh-client-ui-layout@0.1.5-rc.2`
  - `@deepseek-ai/dsh-client-ui-user-questions@0.1.5-rc.2`
- Workspace fork hash: `c9baf56feda333e5ad908220e7cca5a90ceb9aa44100ec43530c1bedb56e3255`.
- Layout fork hash: `d0bc9cc148d6f9f7f96298f16c18b7b2d86d0ab3e827e8aa424738798b1a4fea`.
- User-question fork hash: `82cac65a09c0a5c39f25a868e1ad531f701730c00c9c0f24496dc4203b8611b7`.

Behavioral evidence includes:

- 528px remains one column; 529px becomes two independent vertical flows.
- At viewport 1600px the ceiling is 840px; at 2000px it is 1000px.
- Responsive narrowing preserves the 1000px preference and widening restores it.
- Whole-card click/drag guards, a Session-matched 14px pinned glyph in a 24px hover-only unpin container, no horizontal overflow, and zero browser errors.
- Pin/Unpin publishes optimistic membership and pending state synchronously while writes remain confirmed-revision CAS operations; queued refresh, concurrent intents, 409 retry, and failed-write rollback have direct tests.
- Durable Final extraction, 4,000-code-point bound, cache validation, configurable per-idle-cycle default, same-cycle manual override persistence, and icon-free full-width detail text.
- Goal defaults to collapsed; Todo, Goal, and Final resolve independent configurable defaults, preserve manual overrides for the same lifecycle, and clear only their own override when a new lifecycle begins.
- The Host-backed Better Tasks settings section configures 11–16px detail text (13px default) and Auto/Single/Double columns; optimistic UI changes roll back on rejected writes.
- Restored current Sessions are opened during cold navigation so Goal actions have a binding without requiring a preliminary chat message.
- Every New Session route uses the single `uiWorkspace.onSessionCreated` auto-pin seam.
- `questionSurface` is optional to Better Tasks, preventing service-wait startup deadlocks.

## Real profile and ledger recovery

The real patch disables shipped `ui-layout`, `ui-sidebar`, `ui-workspace`, and `ui-user-questions`, then mounts exactly one local owner for each plus `better-tasks-sidebar`.

A later `LEDGER_LOCKED` was traced to `${DSH_HOME:-$HOME/.dsh}/assistant-session-bridge/receipts/operation.lock`, owned by dead PID `62372`. After confirming the PID was absent, only that stale lock was removed. Three confirmed stale test profiles on ports 3095–3097 were stopped. `session_manage projects` and `session_manage list` then succeeded, proving the bridge ledger was available again. Port 3081 had no listener; only real port 3080 remained.

The latest real cold start completed as PID `9140` on port 3080 with the persisted exact-fork composition. Real Edge CDP held each Host POST open while measuring DOM feedback: optimistic Unpin completed in 27.5ms and Pin in 28.7ms on the first run, then 7.1ms and 5.3ms on the warm run; membership was restored and persisted after each measurement. The same run verified 12px projection detail text, icon-free full-width Final (`display:block`), and zero browser errors. Integrated appearance data, disabled non-ready projections, whole-card guards, independent columns, and zero horizontal overflow remain covered by the broader real regression.

## Failures caught and rules added

1. A hard `questionSurface` dependency was added before its provider existed, causing a service-wait chain that prevented core UI activation. Better Tasks now performs optional lookup with native Composer fallback.
2. A sandbox reused real DSH storage and competed for the ledger. Sandboxes now require a dedicated `DSH_HOME` and disabled Cindy Host.
3. Final auto-open originally used component-memory transition state, so a tab remount reopened a manually collapsed Final. The idle-cycle marker is now persisted by `sessionId → updatedAt`.
4. Final content originally lived only in React memory. The bounded safe projection is now cached in browser storage and invalidated only when the Session `updatedAt` changes.
5. The first settings browser probe treated the injected external store as a raw `hooks` prop, but Slots materializes it as `useTaskPreferences`. The cold-started core stayed healthy, while opening the page surfaced the render failure; the component now consumes the generated hook prop, and the second cold-start plus persistence probe passed with zero browser errors.
