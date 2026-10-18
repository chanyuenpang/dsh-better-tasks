# Sandbox-first technical verification

This file records release-gate evidence only. It does not constitute product acceptance; final acceptance is performed and explicitly confirmed by the user.

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

The `0.2.1` pinned-title candidate repeated the package-mode cold start with the rebuilt Workspace fork. The installed fork contained exactly one `data-dbt-pinned-title-marker` and one `📌` render literal. A fresh upgrade sandbox first cold-started the legacy unscoped `0.2.0` composition, stopped it fully, installed the full scoped `0.2.1` package set, and cold-started again successfully. The final real-profile candidate kept the stable unscoped `dsh-better-tasks@0.2.0` main package and replaced only the Workspace fork from the `0.2.1` release; that exact mixed package graph also cold-started with all core surfaces and zero browser errors. Port 3081 was removed after every gate.

## 2026-09-24 follow-up input candidate

- Command: `$env:DSH_HOME='G:\Projects\dsh-better-tasks\sandbox\dsh-home'; dsh --profile better-tasks-sandbox --patch G:\Projects\dsh-better-tasks\sandbox\cordis.better-tasks.yml --no-open --port 3081` (existing independent sandbox profile; no `--from-default-profile`). Overlay uses the three local UI forks, current Better Tasks source/bundle and explicitly disables `dsh-cindy-host`; Session storage and ledger remain under the dedicated `DSH_HOME`.
- Cold start listened at `http://127.0.0.1:3081/`. Isolated Edge CDP (`sandbox/cdp-followup-smoke.mjs`, port 9223) confirmed root sidebar, native Workspace, conversation composer, Tasks tab, settings surface and four switches including `续行输入栏=false`; no browser runtime/console errors or disabled settings controls. Sandbox had no task rows, so message/Goal and rename behavior is covered by direct action tests, not claimed as browser-tested.
- `npm run check` and `node --test`: 76/76 passed. Stopped the sandbox web job and isolated Edge process tree; verified no listeners remain at ports 3081 and 9223. No real profile edit, install, live reload, or restart occurred.

## 2026-09-24 exact installed-graph gate (`0.2.2`)

- Real Web still referenced stable `dsh-better-tasks@0.2.0` and its installed browser bundle lacked the play toggle. The source build initially omitted `task-actions.mjs`; fixed the builder and added a bundle regression assertion (76/76 tests pass).
- Candidate artifact: `releases/0.2.2-unscoped/dsh-better-tasks-0.2.2.tgz`, SHA-256 `4F4EC78C4AF3A92B09D905B178B9DDC5409387CDE75A269FEB2CD62585C43E5D`; its loader ID remains `dsh-better-tasks`, and it contains both action definitions. Exact installed-graph sandbox profile: `sandbox/dsh-home/profiles/better-tasks-exact`, with real Web bundle graph, real fork archive versions and patch rows, `dsh-cindy-host` disabled. Assistant bridge policy/ledger explicitly remapped to sandbox `DSH_HOME`, never real receipts.
- Command: `$env:DSH_HOME='G:\Projects\dsh-better-tasks\sandbox\dsh-home'; dsh --profile better-tasks-exact --no-open --port 3081`. Listening URL: `http://127.0.0.1:3081/` (ephemeral token omitted). CDP `sandbox/cdp-followup-smoke.mjs` observed sidebar, Workspace, conversation input, Tasks tab, four settings controls (input default false), zero browser errors/disabled controls. This isolated profile has no nonblank task sessions, so a real idle-card click/rename was **not** asserted there; action and task-view contract tests cover behavior, and live card verification remains required after installation.
- Stopped sandbox Host and Edge; audited ports 3081/9223 and sandbox child processes, with no listener/process remaining. No real profile edit was made during this gate.

## 2026-09-24 exact style candidate (`0.2.3`)

- Immutable package `releases/0.2.3-unscoped/dsh-better-tasks-0.2.3.tgz`, SHA-256 `5A6EA27C68AB19E9FA8CC651353649B06B04D13FF39F9A80DE83BEC48BED2CBC`. It preserves stable `dsh-better-tasks` Client identity and embeds action functions. Only the main package changed from the `0.2.2` installed graph; the three fork archives and patch graph match the real Web profile. Cindy Host disabled and all sandbox storage/bridge receipts isolated.
- `npm test` 76/76. Exact package graph cold-started with `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home`, `dsh --profile better-tasks-exact --no-open --port 3081`, listened on `http://127.0.0.1:3081/`. CDP confirmed sidebar, Workspace, conversation input, Tasks tab, four settings controls and zero browser errors. CSS-only task-card fixture measured input `12px/18px`, send circle `34×34px`, and identical computed send background to native composer (`rgb(65, 118, 230)`). This is a style comparison, **not** a live task-card click assertion; isolated profile still has no nonblank task.
- Stopped sandbox Host and Edge and audited 3081/9223 plus sandbox child processes; no listener/process remained. No real Web profile changes were made during the gate.

## 2026-09-24 revised Final-area candidate (`0.2.4`)

- User requested removal of the play control, toggle by clicking expanded Final content, native-sized rename text, and a three-row input. Candidate `releases/0.2.4-unscoped/dsh-better-tasks-0.2.4.tgz`, SHA-256 `136C52A4A9949679AF5449036E12B3878AD47372F045BBB25B2BB7549F8B701F`; stable unscoped Client identity and unchanged fork/patch graph. Unit/contract tests 76/76.
- Exact profile `sandbox/dsh-home/profiles/better-tasks-exact`: sandbox-only DSH_HOME/storage/ledger/bridge state, Cindy Host disabled. `$env:DSH_HOME='G:\Projects\dsh-better-tasks\sandbox\dsh-home'; dsh --profile better-tasks-exact --no-open --port 3081` reached `http://127.0.0.1:3081/`. Isolated Edge CDP checked native sidebar, Workspace, conversation, Tasks, four settings controls, zero browser errors. CSS-only fixture measured three-row 70px input at 12px/18px, rename text 14px, send circle 34×34px and native composer matching background `rgb(65, 118, 230)`. No nonblank Session in this sandbox, so a real Final-area click is **not** asserted here; source contract tests cover its wiring.
- Killed sandbox Host/Edge and separately verified no listening 3081/9223 nor sandbox Host before touching the real Web profile.

## 2026-09-24 quick-message/rename candidate (`0.2.5`)

- Immutable unscoped package `releases/0.2.5-unscoped/dsh-better-tasks-0.2.5.tgz`, SHA-256 `50505433EC01195C94969B990012B84528891F18D99BB6BB51E683EAD5A99991`. Kept existing fork archives and exact patch graph; only main Better Tasks package changed. Settings display label is “快速消息栏” while the persisted `defaultInputExpanded` key remains unchanged. Rename input uses a stable mount ref to focus and select its full initial value.
- `npm test` 76/76. `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home` with exact `better-tasks-exact` profile (independent Session storage/ledger/bridge state, Cindy Host disabled) cold-started `dsh --profile better-tasks-exact --no-open --port 3081` and listened on `http://127.0.0.1:3081/`. Isolated Edge CDP confirmed native sidebar/Workspace/conversation/Tasks, zero browser errors, four enabled settings including “快速消息栏”. Narrow 240px card CSS fixture measured 220px rounded input frame, 70px three-row textarea at 12px, 14px rename input, send circle fully inside frame at 34×34px and matching native button color. Isolated profile has no nonblank task; actual rename selection and card interaction require live acceptance.
- Stopped sandbox Host and Edge; verified no 3081/9223 listeners nor sandbox Host remain. No real Web profile was touched before this gate passed.

## 2026-09-24 one-line auto-grow candidate (`0.2.6`)

- Immutable unscoped `releases/0.2.6-unscoped/dsh-better-tasks-0.2.6.tgz`, SHA-256 `CC078A022A3479F47B8BD6DCEA630409C6841629C07869D3BD2900C61AC3D1AA`. One-row textarea now measures content in `useLayoutEffect`, grows to 120px and scrolls beyond that; manual resize disabled, send button 28×28px. Settings and rename changes from 0.2.5 retained.
- Exact installed-graph `sandbox/dsh-home/profiles/better-tasks-exact` cold-started with sandbox-only DSH_HOME/Session storage/ledger/bridge state and Cindy Host disabled; `$env:DSH_HOME='G:\Projects\dsh-better-tasks\sandbox\dsh-home'; dsh --profile better-tasks-exact --no-open --port 3081` reached `http://127.0.0.1:3081/`. `npm test` 76/76. Isolated Edge CDP verified root/Workspace/conversation/Tasks/settings and zero browser errors. CSS-only narrow-card fixture measured one row 32px, `resize:none`, 28px send circle inside the 220px rounded card and matching native color; settings label “快速消息栏”. No sandbox task card exists, so dynamic typing/auto-grow still needs a real UI confirmation.
- Sandbox Host and Edge stopped; no 3081/9223 listeners or isolated Host left. **0.2.6 is not installed into real Web** pending ask-user-question font ownership review and combined release; user's refusal of restart is honored.

## 2026-09-24 combined quick-message/question candidate (`0.2.7`)

- Immutable `dsh-better-tasks@0.2.7` archive `releases/0.2.7-unscoped/dsh-better-tasks-0.2.7.tgz` SHA-256 `C220BCC11D1C0335249F94EBED606B4D95783E5C4D90B466670EB7596F64AE2A`; updated same-identity question fork archive `releases/0.2.7-unscoped/deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz` SHA-256 `3DA9BFD6A4A8CBB44F5E807ECE4026AFF262EA32A1CC3879747740E1258D603A`. Question fork provenance patch/lock refreshed and verified; `npm test` 76/76. Only task-card question styles change; Composer/PlanReview retain native typography.
- Exact graph sandbox `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home`, profile `better-tasks-exact` with the two new archives plus the real other dependency/patch rows, independent Session storage/ledger/bridge state, Cindy Host disabled. `dsh --profile better-tasks-exact --no-open --port 3081` reached `http://127.0.0.1:3081/`; startup-only browser check found sidebar, Workspace, conversation and Tasks activated with **zero browser errors**. No automated CSS/visual measurement was run for this candidate, per updated `AGENTS.md`; user owns visual acceptance.
- Stopped Host and Edge and verified no sandbox 3081/9223 listeners or Host process before real installation.

## 2026-09-24 subordinate input and compact question actions (`0.2.8`)

- `releases/0.2.8-unscoped/dsh-better-tasks-0.2.8.tgz` SHA-256 `D5F81C7D7443D56291BEF7700D38C151B5CAFE00EA7F9B7527109969BB992E69`; same-identity task-question fork archive `releases/0.2.8-unscoped/deepseek-ai-dsh-client-ui-user-questions-0.1.5-rc.2.tgz` SHA-256 `F2C4C682BB704A616299B3FEE5CCE63D4ADC0BD989CFA8CF29A0993332E9A286`. Fork provenance verified at `94180de2d36d46cbefcb8a81d3575238f887b80fcfe0cb0a2a1c13d4e66457fc`; `npm test` 76/76. Final close now hides subordinate quick input without unmounting its idle draft, task-question skip/submit scoped to compact buttons, quick-input border uses l1 token.
- Exact sandbox graph `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home`, `better-tasks-exact` profile, independent Session storage/ledger/bridge and Cindy Host disabled. `dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; browser startup-only check confirmed root/sidebar, Workspace, conversation and Tasks, **zero errors**. No automated CSS/visual measurements. Stopped sandbox Host and Edge and audited no 3081/9223 listeners or Host process before real install.

## 2026-09-28 npm scoped candidate (`0.2.2`)

- Candidate `releases/0.2.2/veewo-dsh-better-tasks-0.2.2.tgz`, SHA-256 `03414973eb774d871180f9af506d9bb1d0f819b5feff1995215d80df6e63518a`; three exact-fork archives and their hashes are in `releases/0.2.2/manifest.json`. Packed browser bundle registers `@veewo/dsh-better-tasks`, including the idle task action. `npm test` 76/76 and `npm run check` passed.
- Exact package graph installed in the isolated `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home`, profile `better-tasks-exact`: scoped candidate and three release fork archives, disabled native layout/sidebar/workspace/user-questions rows, Cindy Host explicitly disabled; independent Session storage, bridge policy/ledger. Command: `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081`. Listening URL: `http://127.0.0.1:3081/` (token omitted). Isolated Edge startup-only probe confirmed root/sidebar, Workspace, conversation, Session/Tasks tabs, Tasks surface, **zero browser errors**. No visual measurement or task-card interaction was asserted.
- Stopped the sandbox Host and Edge; verified zero listeners on ports 3081/9223 and no candidate Host/Edge process before npm publication. Published the exact archive to npm public as `@veewo/dsh-better-tasks@0.2.2`; registry readback returned `sha512-M6K/Ppr/UV14qfXN4qG1FgFKG0OihwOtxkTEnIOk1FVlz4oti9c0pvWTxV3Evu7eamwDC/B/w5dFPXDtNV54jw==`, SHA-1 `596454736a176898712ea6f2e9107717aac0b871`, and `latest=0.2.2`. No real Web profile was installed or restarted.

## 2026-09-28 local unscoped profile candidate (`0.2.9`)

- Archive `releases/0.2.9-unscoped/dsh-better-tasks-0.2.9.tgz`, SHA-256 `b18f472f40284fc0b20ce5de9a3da9e834f599e90bc47da6c7d28be0c0c1d118`, 66,113 bytes; loader ID `dsh-better-tasks` (not scoped), idle action included. `npm test` 76/76 and `npm run check` passed. The three unchanged fork archive hashes match the actual Web Profile dependencies; see `releases/0.2.9-unscoped/manifest.json`.
- Exact composition: `DSH_HOME=G:\Projects\dsh-better-tasks\sandbox\dsh-home`, profile `better-tasks-exact`, real Web dependency graph except the candidate main archive, identical installed fork archive paths/hashes, unscoped composition row, disabled native rows; Cindy Host explicitly disabled. Session storage and bridge policy/ledger are sandbox-only. Command: `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081`. Reached `http://127.0.0.1:3081/` (token omitted). Independent Edge startup-only probe confirmed root/sidebar, Workspace, conversation, Session and Tasks tabs, Tasks view, **zero browser errors**. No visual measurement or task-card interaction was claimed.
- Stopped sandbox Host PID 41360 and Edge PID 30276; verified zero 3081/9223 listeners, zero candidate processes, and unchanged real Web listener PID 16304 on port 3080 before any real Profile installation.
- After the gate, copied the SHA-256-matching archive to `C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.9-unscoped/` and backed up real `web` package.json, pnpm-lock.yaml and cordis.patch.yml there. `dsh plugin --profile web add <archive>` updated only the unscoped main package dependency to 0.2.9; installed package metadata and browser loader ID both read back as `dsh-better-tasks`. The real patch hash is unchanged, the three fork dependency paths are unchanged, and port 3080 is still owned by original PID 16304; sandbox ports remain closed. **No real Host restart or page refresh performed; updated package is staged for a later explicitly approved restart.**

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

The package-mode real cold start completed on port 3080. Real Edge opened the native Better Tasks settings section, verified 13px and `Todo=false / Goal=false / Final=true / Auto`, toggled Todo to true while Goal remained false across reload, persisted 14px, restored Todo=false and 13px, and recorded zero browser errors. The preceding optimistic Pin/Unpin regression held Host POSTs open while DOM feedback completed in 27.5–28.7ms initially and 5.3–7.1ms warm; membership was restored after every measurement. Integrated appearance, full-width Final, disabled non-ready projections, whole-card guards, independent columns, and zero horizontal overflow remain covered by the broader regression.

The final approved clean restart started PID `24380` from the package-only profile. Real Edge inspected five visible Session rows: all three pinned rows had exactly one `📌` prefix with `aria-hidden="true"`, both unpinned rows had no marker, and browser runtime/console errors were zero. The complete root/sidebar/Session/Workspace/Tasks smoke passed, `session_manage list` responded normally, only port 3080 remained, and the installed Workspace source contained exactly one marker registration.

## Failures caught and rules added

1. A hard `questionSurface` dependency was added before its provider existed, causing a service-wait chain that prevented core UI activation. Better Tasks now performs optional lookup with native Composer fallback.
2. A sandbox reused real DSH storage and competed for the ledger. Sandboxes now require a dedicated `DSH_HOME` and disabled Cindy Host.
3. Final auto-open originally used component-memory transition state, so a tab remount reopened a manually collapsed Final. The idle-cycle marker is now persisted by `sessionId → updatedAt`.
4. Final content originally lived only in React memory. The bounded safe projection is now cached in browser storage and invalidated only when the Session `updatedAt` changes.
5. The first settings browser probe treated the injected external store as a raw `hooks` prop, but Slots materializes it as `useTaskPreferences`. The cold-started core stayed healthy, while opening the page surfaced the render failure; the component now consumes the generated hook prop, and the second cold-start plus persistence probe passed with zero browser errors.
6. The first scoped npm candidate kept the old unscoped browser loader ID, so DSH correctly rejected `@veewo/dsh-better-tasks` as “loaded without registering.” The builder and bundle smoke test now require the scoped loader ID; a clean reinstall and cold start then passed.
7. Live-switching the main Client package identity from `dsh-better-tasks` to `@veewo/dsh-better-tasks` left the old locale fiber overlapping the new registration and temporarily slowed page/session activation. The real profile was restored immediately. Identity migrations must happen only while the Host is stopped; the `0.2.1` rollout instead kept the stable main identity and updated only the Workspace fork after an exact mixed-graph sandbox gate.

## 2026-09-29 Final Markdown candidate

- Candidate source/bundle: `src/client.js` and `lib/client.js`; native `MarkdownText` with localized code-copy/footnote labels replaces plain-text Final body without changing Final extraction or optional service dependencies. Final candidate `npm run build` and 13 focused Final/client tests passed.
- Isolated command: `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --patch G:/Projects/dsh-better-tasks/sandbox/cordis.markdown-candidate.yml --no-open --port 3081`. The overlay replaces only the main Better Tasks row with current source/bundle; the existing exact sandbox profile retains installed forks, disabled native rows, separate Session/ledger storage, and disabled `dsh-cindy-host`.
- Listened at `http://127.0.0.1:3081/` (token omitted). Isolated Edge CDP startup-only probe confirmed root/sidebar, Workspace, conversation, Session and Tasks tabs, Tasks view, and **zero browser runtime/console errors**. There were no populated task cards in the sandbox, so Final visual appearance remains for the user to judge in the real interface; no screenshot or CSS measurements were run.
- Stopped sandbox Web and Edge, verified ports 3081/9223 closed; real 3080 remained unchanged. No real profile installation, live reload or restart occurred.

## 2026-09-29 exact packaged Final Markdown gate (`0.2.10`)

- The actual real Web profile still had `dsh-better-tasks@0.2.9`; its installed bundle contained `dbt-final-copy` as plain text, explaining why restarting alone did not enable Markdown. Candidate archive: `releases/0.2.10-unscoped/dsh-better-tasks-0.2.10.tgz`, SHA-256 `DC72E03ABB179532106EE29094E56061D9C75F80CE89D4B6ED2ECF5D8C19F2E9`, same unscoped identity and `MarkdownText` in installed bundle. `npm test`: 76/76. Three existing fork archive paths and native-disabled rows unchanged.
- Installed this exact archive into the independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, `better-tasks-exact` profile with sandbox-only Session/ledger/bridge policy and disabled `dsh-cindy-host`. Command: `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081`. Reached `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks tabs and Tasks view with **zero browser errors**. Empty sandbox had no task cards; no visual QA was claimed.
- Stopped sandbox Web and Edge, confirmed ports 3081/9223 closed and only the original real 3080 listener remained before any real installation.

## 2026-09-29 Final light-background/border-hover gate (`0.2.11`)

- Candidate `releases/0.2.11-unscoped/dsh-better-tasks-0.2.11.tgz`, SHA-256 `32394635362CBB9F488284884EC2F768F2459F494117177D1B43DE990F657C80`: Final uses `--dsw-alias-bg-layer-1`, hover changes only border color, not background. Same unscoped identity, unchanged fork archives/disabled native rows; `npm test` passed 76/76.
- Installed exact archive into isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact` (separate Session/ledger/bridge; `dsh-cindy-host` disabled). `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` reached `http://127.0.0.1:3081/`; isolated Edge startup-only check confirmed sidebar, Workspace, conversation, Session/Tasks tabs and Tasks view, browser errors **0**. No populated task cards or automated visual measurement; user evaluates appearance.
- Stopped isolated Web and Edge; confirmed ports 3081/9223 closed before real installation, real 3080 unchanged.

## 2026-09-29 Final spacing follow-up (`0.2.12`)

- User confirmed lighter color/border-only hover already visible but requested more breathing room around Final text and explicitly did not approve a restart. Candidate `releases/0.2.12-unscoped/dsh-better-tasks-0.2.12.tgz`, SHA-256 `310336DD9C358C417EE0AE1467DA81E66206940FFA978DF1A1F0D4EB0AF07A83`: Final outer padding 10px, inner hover boundary inset 3px with 8px inner padding. Existing light background and border-only hover unchanged; 76/76 tests passed.
- Exact archive installed into independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`, separate Session/ledger/bridge, unchanged fork graph/disabled native rows and disabled `dsh-cindy-host`. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`. Startup-only Edge check activated root/sidebar, Workspace, conversation, Session/Tasks views, browser errors **0**. No visual measurement.
- Sandbox Web and Edge stopped; 3081/9223 closed and only original real 3080 listener remained before any real install.

## 2026-09-29 Final click and no-hover candidate (`0.2.15`)

- Root cause of broken Final click: its own `role="button"` matched the interactive-descendant guard. User requested ordinary Markdown clicks to toggle quick input, links alone to retain navigation, and double-click to close Final. The candidate removes Final hover CSS and adds link-only click exclusion and double-click close; direct click-guard regression test plus suite 77/77 passed. Supersedes intermediate uninstalled 0.2.13/0.2.14 archives.
- Exact archive `releases/0.2.15-unscoped/dsh-better-tasks-0.2.15.tgz`, SHA-256 `683ECE0045A470BF1A3AA6B975D0B904E71E5512411CA340724A70C38B9227DC`. Installed into sandbox-only `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, `better-tasks-exact` with separate Session/ledger/bridge, disabled Cindy Host, unchanged forks/native-disabled rows. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only check activated sidebar, Workspace, conversation and Session/Tasks, browser errors **0**. No populated task cards or visual measurements in sandbox.
- Stopped sandbox Web and Edge; verified 3081/9223 closed with only original real 3080 listener before real install.

## 2026-09-29 Final capture-phase follow-up (`0.2.16`)

- Supersedes the already-installed 0.2.15: moves both single and double Final clicks to capture phase so nested Markdown controls cannot swallow default toggle/close actions. Links remain exempt; no Final hover; keyboard focus outline retained. `npm test` 77/77 passed. Exact archive `releases/0.2.16-unscoped/dsh-better-tasks-0.2.16.tgz`, SHA-256 `9284FED254FC63AA5EDC8ED24102F81C0E224663D03BFBDC631A3AD7185CAD83`.
- Installed exact candidate in independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact` with unchanged three fork paths/native-disabled rows, separate Session/ledger/bridge and disabled `dsh-cindy-host`. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks, browser errors **0**. No sandbox task cards or visual measurement.
- Stopped sandbox Host/Edge; verified ports 3081/9223 closed, original real 3080 untouched before installation.

## 2026-09-29 exclusive Final click and state-aware Unpin (`0.2.17`)

- User requested claw-planned combined delivery. Final click controller delays non-link single click 600ms, double-click cancels pending single and closes only Final, manual Final close and unmount cancel pending timers; Unpin remains transparent in every state and takes neutral, success green, or block yellow icon color via card-local tokens. `npm test` 78/78 passed; no automated visual measurement.
- Exact same-identity candidate `releases/0.2.17-unscoped/dsh-better-tasks-0.2.17.tgz`, SHA-256 `546FDB287672AA7004EE708480AD9DE54A2BCE99AE1145C473452A4DB6954F99`, installed into separate `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; three fork archive paths equal real Web, disabled native rows and `dsh-cindy-host`, independent Session/ledger/bridge. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`. Isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks, browser errors **0**. Empty sandbox has no populated task cards.
- Stopped sandbox Host and Edge, verified 3081/9223 closed and only real 3080 still listening before installation.

## 2026-09-29 Final click pending feedback (`0.2.18`)

- Feature-architecture summary: the only new concept is nonpersistent per-Session pending-click visual feedback, owned by the existing Final click controller and TaskSwimlane render state, not Host or stored expansion. Non-link click colors Final lightly immediately; at 600ms single-click resolution or double-click cancellation the controller clears feedback before the action. Manual close/keyboard cancel and unmount clear timers; link clicks and immediate keyboard behavior unchanged. `npm test` 78/78 passed, no automated visual measurement.
- Same-identity archive `releases/0.2.18-unscoped/dsh-better-tasks-0.2.18.tgz` SHA-256 `DD79C7A3AC97723CFB230240C6E06FD8AD18820FA640F6842221E1C0258CB83F`, installed into isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, `better-tasks-exact`, with separate Session/ledger/bridge, disabled Cindy Host/native rows, and same three fork archive paths as real Web. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks views, browser error count **0**. Empty sandbox has no task cards for visual appearance verification.
- Stopped sandbox Host/Edge and verified 3081/9223 closed; only original real 3080 remained before installation.

## 2026-09-29 stricter double-click and animated tint (`0.2.19`)

- User requested faster single-click response with stricter double-click timing and a longer/smoother pending tint. The candidate shortens the pending window from 600 to 300ms; only the second native click while the first is pending counts as double, so a late native `dblclick` cannot close Final after a single action. Background-color transitions in over 220ms and out over 340ms, with reduced-motion fallback and no hover rule. All 78 package tests passed; no computed CSS, pixel or screenshot measurements were performed.
- Exact same-identity archive `releases/0.2.19-unscoped/dsh-better-tasks-0.2.19.tgz` SHA-256 `E204ED6F3E53FA3A9C38D2423183FA2C829E83A455A842F8CD42C26E1D2D6BEF` installed into independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; same real Web fork archives/native-disabled rows, separate Session/ledger/bridge and disabled Cindy Host. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only check activated root/sidebar, Workspace, conversation, Session/Tasks views with browser errors **0**. Empty sandbox has no populated task cards for visual appearance verification.
- Sandbox Web/Edge stopped and ports 3081/9223 closed; real 3080 process left untouched before install.

## 2026-09-29 quick-input placeholder and blank Continue (`0.2.20`)

- Quick input starts and resets with an empty draft; localized `tasks.continueDefault` is placeholder only. Blank/whitespace-only submit resolves to localized Continue before calling the native idle session action; nonblank user text is passed verbatim. Empty send button is enabled, while IME composition, busy lock, and failure retention remain. `npm test`: **79/79** passed.
- Exact same-identity archive `releases/0.2.20-unscoped/dsh-better-tasks-0.2.20.tgz` SHA-256 `659607E236BFB40D23E2958D597B1A6E7DF79FB9C242BA735651153DCC8E2525`, installed into isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; fork archive paths equal real Web, independent Session/ledger/bridge, disabled Cindy Host/native rows. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks views, browser errors **0**. Empty sandbox has no task cards to test input manually.
- Stopped sandbox Web/Edge and verified 3081/9223 closed; only original real 3080 remained before installation.

## 2026-09-29 focus-aware quick-input placeholder (`0.2.21`)

- Continue placeholder now appears only when draft is exactly empty and textarea unfocused; focus hides it, blur restores it only if still empty. Blank-submit default Continue and verbatim nonblank sending from 0.2.20 stay unchanged. `npm test`: **80/80** passed; no visual measurement.
- Exact same-identity archive `releases/0.2.21-unscoped/dsh-better-tasks-0.2.21.tgz` SHA-256 `042771F520EBC8E956A8DCEEAE352B53E8251A199F8B065250F22DB0498B7EA7` installed in isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; three UI fork archive paths equal real Web, separate Session/ledger/bridge, native rows/Cindy Host disabled. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation and Session/Tasks views, browser errors **0**. Sandbox has no task cards to test actual focus visually.
- Sandbox Web and Edge stopped, ports 3081/9223 confirmed closed; only original real 3080 remained before installation.

## 2026-09-29 project/task name emphasis preference (`0.2.22`)

- New Host-backed `titleEmphasis` preference supports `project` (current default) and `task`, with a bilingual task-view setting. Client decoder supplies `project` for old values missing only the new field while retaining existing preferences; invalid values reject and failed writes roll back. Task mode swaps project/task name font sizes, weights and primary/secondary colors without changing rename behavior. `npm test`: **82/82** passed; no automated visual measurements.
- Exact same-identity archive `releases/0.2.22-unscoped/dsh-better-tasks-0.2.22.tgz` SHA-256 `4B2135217DCB96E20E5030CF238311D185C4EA22B72CCB719BA6D515F3F2B6CE`, installed in isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; same three fork archives as real Web, separate Session/ledger/bridge and disabled Cindy Host/native rows. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`. Isolated Edge startup-only probe activated root/sidebar, Workspace, conversation and Session/Tasks views, browser errors **0**. Sandbox has no task cards, so no visual acceptance was performed.
- Stopped sandbox Web/Edge and verified 3081/9223 closed; only original real 3080 remained before installation.

## 2026-09-29 whole quick-input focus and drag guard (`0.2.23`)

- Clicking non-control areas of the rounded quick-input form, including the lower action row, focuses its textarea; send still submits. The shell is non-draggable and shows a text cursor; a task-card pointer-origin guard rejects card drag/click starting inside controls even if the browser retargets the event to the draggable ancestor. Other card areas remain draggable. `npm test`: **83/83** passed. This archive does **not** implement `/` command menus; the user chose focus/drag delivery first and per-card native slash as a separate larger task.
- Exact same-identity archive `releases/0.2.23-unscoped/dsh-better-tasks-0.2.23.tgz` SHA-256 `D9938F65657D69ED707F9FF0D2742E0C950F70CF8C936C283F3873EC4FBA9E95`, installed into independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`; fork archive paths equal real Web, separate Session/ledger/bridge, disabled Cindy Host/native rows. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks with browser errors **0**. Empty sandbox has no cards for pointer behavior testing, which is contract-tested only.
- Sandbox Web/Edge stopped; ports 3081/9223 closed, only real 3080 PID 9148 remained before installation.

## 2026-09-29 task-card plus skill picker (`0.2.24`)

- The per-card plus button opens a skill-only search using the Host-owned `remote.skills.list({sessionId})` catalog, with the official plus icon. Choosing one inserts the official `/name ` gesture into that card textarea without automatic send. Existing empty “继续”, nonempty steer, IME/send guards and drag boundaries are unchanged; this does **not** clone the native all-command plus menu. `npm test`: **86/86** passed; no automated visual measurement.
- Exact same-identity archive `releases/0.2.24-unscoped/dsh-better-tasks-0.2.24.tgz` SHA-256 `95385B91A12C4DE16A2CBE8E1D0B8139934B5E3BA714BB907D9E96573DE5FB4D` in isolated `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-exact`, with the same three fork paths and disabled Cindy Host/native rows as real Web, independent Session storage/ledger. `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-exact --no-open --port 3081` listened at `http://127.0.0.1:3081/`; isolated Edge core startup probe activated root/sidebar, Workspace, conversation and Session/Tasks with **0 browser errors**. Empty sandbox had no cards; no visual picker check claimed.
- Stopped sandbox Web/Edge; verified 3081/9223 closed and only existing real 3080 PID 9148 remained before real installation.

## 2026-09-29 npm scoped release candidate (`0.2.3`)

- User explicitly confirmed that already-loaded local unscoped `0.2.24` looked good and authorized a new version publish. The scoped bundle body matches that accepted local archive after replacing only ModuleLoader identity. Public scoped version `0.2.3` was free before packaging. `npm test`: **86/86** passed; no automated visual measurements. Four exact archives and SHA-256/byte sizes are recorded in `releases/0.2.3/manifest.json`; scoped main SHA-256 `ff92b2bb2a3bc706c7b1ccfe088378006bd5850f0dcee96968aada81ee2da047`.
- Exact candidate installed in independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/dsh-home`, profile `better-tasks-sandbox`: `@veewo/dsh-better-tasks@0.2.3` plus all three fork tgz from `releases/0.2.3/`. Sandbox patch `sandbox/cordis.packaged.yml` disables native layout/sidebar/workspace/questions rows and Cindy Host, and inserts all four immutable package-name rows; Session storage, service bridge and ledger are sandbox-owned. Command: `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/dsh-home"; dsh --profile better-tasks-sandbox --patch "G:/Projects/dsh-better-tasks/sandbox/cordis.packaged.yml" --no-open --port 3081`. The scoped candidate listened on `http://127.0.0.1:3081/` (token omitted); isolated Edge startup probe activated root/sidebar, Workspace, conversation, Session/Tasks with **0 browser errors**. Empty sandbox had no cards; no additional functional picker or visual acceptance claimed.
- Sandbox Web/Edge stopped; ports 3081/9223 closed and only existing real Web port 3080 PID 9148 remained before public npm publish. Real Web unscoped `0.2.24` is not modified by the scoped publication.
- `npm whoami` returned `chanyuenpang`; the public `npm publish releases/0.2.3/veewo-dsh-better-tasks-0.2.3.tgz --access public` request was accepted (`+ @veewo/dsh-better-tasks@0.2.3`, exit 0) with registry processing notice. Local archive expected integrity is `sha512-KcLa4FznieD/ET1jyGyBUVP2OGmEvWFLKDfFbzYCxMfYFXezozogmyPB5hWeqMcdbSgu7x0mpMEvE8UH3OwM3A==`, SHA-1 `ac8a49aa124e4e8feabe8e348e7c76840e6c4859`. After asynchronous registry processing, readback returned `@veewo/dsh-better-tasks@0.2.3` with `latest=0.2.3`, published integrity and SHA-1 exactly matching this immutable local archive. Real Web still resolves local unscoped `0.2.24` and port 3080 PID 9148.

## 2026-09-29 scoped identity migration exact target gate

- Independent `DSH_HOME=G:/Projects/dsh-better-tasks/sandbox/identity-home` profile `web` models the real `web` bundles and direct dependency specifiers (same three exact fork archive paths/hashes) except a **single** scoped main `@veewo/dsh-better-tasks@0.2.3` tgz SHA-256 `ff92b2bb2a3bc706c7b1ccfe088378006bd5850f0dcee96968aada81ee2da047`, with no installed old `dsh-better-tasks`. Sandbox patch keeps all real disabled native rows and only changes main plugin name; additionally disables `dsh-cindy-host` and redirects bridge policy/receipt state into the isolated home. Session storage, cost ledger, and services configuration are sandbox-owned.
- The initial isolated install drifted from the real transitive graph and lacked the real cost-meter patch, so it was **not used as a gate**. Corrected it by mirroring the real `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and cost-meter patch into sandbox, reconciling only the scoped main, and running a frozen install. Both locks now have `autoInstallPeers:false`, the same `dsh-cost-meter@1.7.28` patch hash `6369afc04479aaa3b658cf902d69aada8c423a7eae158dbf75ff24c2ec593a0b`, and the same 200 non-main package identities (only two file archive keys differ by equivalent absolute-vs-relative path forms). The installed sandbox cost-meter contains its local patch.
- `$env:DSH_HOME="G:/Projects/dsh-better-tasks/sandbox/identity-home"; dsh --profile web --no-open --port 3081` listened at `http://127.0.0.1:3081/` (token omitted). Isolated Edge startup-only probe activated root/sidebar, Workspace, conversation, Session/Tasks with **0 browser errors**; empty sandbox had no cards and no visual/functional product acceptance. Stopped Host/Edge and verified 3081/9223 closed, sandbox Host PID gone, only real 3080 PID 9148 remained. No live Web identity or patch was changed.

## 2026-09-29 stopped-host identity swap rehearsal (sandbox only)

- Created a sibling scoped stage `sandbox/identity-home/profiles/web-stage-023` from the frozen exact target graph, then restored `profiles/web` to the real-shaped unscoped `0.2.24` archive, unchanged fork paths and patched cost-meter. Cold-started old `web` on `http://127.0.0.1:3081/` (token omitted), then stopped it and verified no sandbox listener before renaming. The scoped stage was never started alongside old Host.
- Offline swap of `web`→`web-old-023`, `web-stage-023`→`web` exposed a genuine non-TTY failure: pnpm rejected relocation of hoisted modules (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Explicit catch restored both directories; old unique package stayed present and no backup/partial active candidate remained. Retrying with `CI=true` and `dsh plugin --profile web install --offline --frozen-lockfile` rebuilt the renamed profile in 6.7s, repaired `.modules.yaml` absolute `virtualStoreDir` to the new `web`, and left only scoped main installed.
- Relocated scoped profile cold-started on `http://127.0.0.1:3081/`, isolated Edge root/sidebar/Workspace/conversation/Session/Tasks probe found **0 browser errors**. After stopping Host/Edge, reversing directory swap and running the frozen offline refresh recovered only old unscoped package and old patch; restored old profile cold-started/listened successfully. Sandbox listeners 3081/9223 and host jobs were killed, only real 3080 PID 9148 remains. This proves manual stopped-host filesystem operations and rollback, **not** that an automated detached supervisor or a real migration has been authorized or tested.
- Windows WMI **detached** supervisor `scripts/migrate-web-identity.mjs` was then exercised on sandbox port 3081 with old web PID 51080 (real 3080 PID 9148 untouched). Journal `sandbox/watchdog-logs/migration.jsonl` records `requested` (supervisor PID 43060), `stop.begin`/`stop.done`, both directory renames, CI/offline/frozen install, `start.pid` 40020, `start.verified`; scoped candidate listened after process startup. Its first startup took roughly 30 seconds, so the bounded wait was extended to 90 seconds for the real route. The sandbox candidate was stopped and directories returned to unique old `web` plus scoped sibling stage; 3081/9223 closed, old/candidate/supervisor PIDs 51080/40020/43060 all gone. Focused isolated transaction and fault-injection tests passed 12/12. This is **not** authorization to restart real Web.
- Final production-equivalent **direct pnpm** supervisor branch was retested independently with old sandbox Host PID 42416 on port 3081. `sandbox/watchdog-direct-logs/migration.jsonl` records WMI detached supervisor PID 50488, stopping only that target, offline two-directory swap, `CI=true pnpm install --offline --frozen-lockfile` in active Profile (`install.done`), new scoped Host PID 37172 and `start.verified`. Direct pnpm preserves the original `dsh.profile.bundles` precedence (the wrapper `dsh plugin --profile ... install` had reordered the array in an inactive stage, so it was intentionally replaced). New scoped Host PID 37172 stopped; old and stage directories restored, old direct frozen offline repair passed, 3081/9223 closed, PIDs 42416/50488/37172 gone, real PID 9148 unchanged. Full `npm test`: **99/99** passed, including 13 migration/failure tests. This integration is sandbox-only; no real profile identity was activated.

## 2026-09-29 real Web scoped candidate staged, not activated

- After all isolated Hosts/browsers/supervisors and ports 3081/9223 were confirmed gone, copied the immutable scoped `0.2.3` tgz to `C:/Users/chany/.dsh/plugin-releases/dsh-better-tasks/0.2.3-scoped/veewo-dsh-better-tasks-0.2.3.tgz`; verified SHA-256 `ff92b2bb2a3bc706c7b1ccfe088378006bd5850f0dcee96968aada81ee2da047`. Created only the inactive sibling `C:/Users/chany/.dsh/profiles/web-stage-023`, cloning original manifests, patch, workspace/cost patch and three fork archive paths; its package dependency and one composition row point to scoped main. Frozen `pnpm` stage install succeeded offline; package graph has exactly the same 200 non-main lock identities as the old real profile and retains the original `dsh.profile.bundles` order. No old unscoped main exists in the stage; the active old profile has no scoped main.
- The original active `profiles/web` package.json, pnpm-lock.yaml, cordis.patch.yml, pnpm-workspace.yaml hashes still match `0648B013…`, `772D87AA…`, `A9DD12E9…`, `2BD4CF6A…`; real listener remains 3080 PID 9148. Official restart dry-run confirmed `web`, original working directory `G:/Projects/dsh-better-tasks`, 3s grace; the final guarded supervisor dry-run returned PID 9148, only scoped sibling stage, CI/offline/frozen **direct pnpm** in the stopped Host window, original relaunch args `["web"]`, and no mutation. Real identity **has not been switched or restarted**; `ask_user_question` explicit one-time consent remains necessary before apply.










