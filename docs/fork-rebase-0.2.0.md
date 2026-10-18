# Client UI forks on the 0.2.0-rc.2 baseline

Status of moving the three version-locked client UI forks from the dsh `0.1.5-rc.2`
line to the `0.2.0-rc.2` line that DSH Desktop runs.

## Why this is needed

The three fork packages are **direct profile dependencies**, and dsh's runtime
resolution table gives a profile-local package precedence over the installation's own
copy. So while they stay on the 0.1.5 line they shadow the desktop app's 0.2.0-rc.2
client UI packages. Client plugins are **not** covered by the peer gate
(`dsh-client-modules` only checks `dsh.client.platform === 'web'`), so this drift fails
silently and only shows up as a broken interface.

The dependency half of the same class of problem is fixed; see
[§ Dependency coupling](#dependency-coupling).

## Status

| package | src patch | built | notes |
| --- | --- | --- | --- |
| `ui-layout` | ✅ `src-patches/ui-layout/0.2.0-rc.2-better-tasks.patch` | ✅ `forks-0.2.0-rc.2/ui-layout/` | complete — 33762 B, sha256 `b2a9d7705f71cdfa…` |
| `ui-workspace` | ❌ | ❌ | see [§ Remaining work](#remaining-work) — **the one fork that cannot be skipped**, see [§ Better Tasks' hard client contract](#better-tasks-hard-client-contract) |
| `ui-user-questions` | ✅ `src-patches/ui-user-questions/0.2.0-rc.2-better-tasks.patch` | ✅ `forks-0.2.0-rc.2/ui-user-questions/` | complete — 102335 B, sha256 `b4a936994c0892ce…`; boot-checked with Better Tasks 0.2.5 (`disabled rows: 0`, `pending: 0`, HTTP 200) |

Verify with `node scripts/verify-forks-0.2.0.mjs` (`--write` records artifact
sha256s into `provenance/forks-0.2.0-rc.2.lock.json`; `--require-all` is the release
gate and fails while any slug is unported; `--profile <dir>` additionally asserts an
installed profile — see [§ Assertion split](#assertion-split-source-patch-vs-artifact)).

The **active** baseline is still 0.1.5: `forks/<slug>/` and `provenance/<slug>.lock.json`
describe the released 0.1.5 forks, and `npm run build:fork` regenerates them. The 0.2.0
work is staged under `forks-0.2.0-rc.2/` so `build:fork` cannot clobber it. Promote to
`forks/` only once all three slugs have a source patch.

## Why the fork is built from source, not from the published artifact

The npm tarballs publish only built `lib/` — the `"./src/*"` export maps to files that
are not in the tarball, so patching built JS was previously the only option. The tag's
source **is** available, so the fork is a real source fork: reviewed `src/` deltas on a
pinned tag, built through the unmodified official preset.

### Getting the tag source

`git fetch` of the tag **hangs indefinitely** in this environment (smart-HTTP). codeload
over HTTPS works, so use a resumable download:

```powershell
curl.exe -sS -L -C - --max-time 120 -o "$env:TEMP/dsh-v0.2.0-rc.2.tar.gz" `
  https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/dsh-v0.2.0-rc.2
```

The tarball is vendored at `third_party/source/dsh-v0.2.0-rc.2.tar.gz` and its sha256 is
pinned in `provenance/source.lock.json`; the build script verifies it on every run.

### The standalone build root

`npm run build:lib:client` in the monorepo is `tsc -b tsconfig.client.json && tsdown
--env.DSH_BUILD_FACE client` — a workspace-wide project-reference build. The fork does
not change the node half, and with `DSH_BUILD_FACE` unset the official preset's client
entry is `src/client/index.ts`, so the browser artifact builds straight from TSX. That
makes a standalone root sufficient:

- `packages/client/tsdown.client.ts` — the official preset, **unmodified**
- its four monorepo-internal imports: `modules/src/client/manifest.ts`,
  `web/src/platform.ts`, `scripts/client-build-environment.ts`,
  `scripts/bundle-input-isolation.ts`
- the root `tsconfig*.json`
- the three client packages

Three mechanical adaptations, none touching official logic:

1. copy the root `tsconfig*.json`;
2. drop `references` from each package's `tsconfig.json` (they describe the `tsc -b`
   graph, and rolldown aborts on a dangling reference);
3. set `DSH_CLIENT_COMMIT_HASH` / `DSH_CLIENT_TITLE` / `DSH_CLIENT_BUILD_PROFILE` so the
   preset does not shell out to `git` and stamps the official build constants.

The client config is selected by filtering the preset's returned array on `config.name`
(the node half is named `id`, the client half `id/client`).

### Fidelity

Building an **unmodified** 0.2.0-rc.2 `ui-layout` through this root reproduces the
published npm artifact exactly:

```
EQUIVALENT  .srcbuild/packages/client/ui-layout/lib/client.js
         == third_party/ui-layout/0.2.0-rc.2/package/lib/client.js
```

Normalization (`scripts/compare-client-bundles.mjs`) removes only seed-derived CSS
class-name hashes, build-path `//#region` comments, `@__PURE__` annotations and require
declaration order.

`ui-workspace` and `ui-user-questions` retain ~294 / ~66 differing lines: the `src` route
inlines TS downleveling helpers (`__create`, `__defProp`, …) that the CI route had already
lowered through its tsc intermediate. Semantically equivalent, not byte-identical — an
inherent difference between the two routes.

## Using the pipeline

```bash
node scripts/build-forks-from-source.mjs --stage              # stage .srcbuild from the pinned tag
node scripts/build-forks-from-source.mjs --build              # stage, apply src patches, build
node scripts/build-forks-from-source.mjs --emit-patch ui-layout
node scripts/build-forks-from-source.mjs --build --source <extracted tag dir>
```

`--build` always re-stages, so recorded patches must apply to pristine tag sources.
Slugs without a recorded patch are skipped and their `forks/` entry is left alone.
Output lands in `forks-0.2.0-rc.2/<slug>/lib/client.js`; the build is byte-reproducible.

### Reviewing and authoring a src patch

1. Edit the package under `.srcbuild/packages/client/<slug>/src/`.
2. `node scripts/build-forks-from-source.mjs --emit-patch <slug>` writes the diff against
   the pinned tag to `src-patches/<slug>/0.2.0-rc.2-better-tasks.patch`.
3. `node scripts/build-forks-from-source.mjs --build` to confirm it replays byte-identically.

## `ui-layout` delta (complete)

`src-patches/ui-layout/0.2.0-rc.2-better-tasks.patch`, three files:

- `src/client/columns.ts` — `SIDEBAR_MAX` 420 → 840; new `sidebarMax(viewport) =
  max(840, viewport * 0.5)`; `computeColumns` clamps to `SIDEBAR_MIN..sidebarMax(viewport)`.
- `src/client/stores.ts` — new `SIDEBAR_WIDTH_STORAGE_KEY =
  'dsh-better-tasks.layout.sidebar-width.v1'`, `readSidebarWidthPreference()`,
  `writeSidebarWidthPreference()`, a module-level `sidebarExpandedPreference`, and an
  exported `currentSidebarPreference()`; `init`, `setSidebar` and `toggleSidebar` adopt
  the persist-and-restore semantics.
- `src/client/AppFrame.tsx` — `sidebarPreference` falls back to
  `currentSidebarPreference()` instead of `SIDEBAR_DEFAULT`.

Behaviour matches the README contract (`264px..max(840px, 50vw)`, preserved across
collapse and refresh).

**Trade-off taken.** The 0.1.5 fork pressed all of this into one built bundle's module
scope. Here it is split by responsibility — `columns.ts` owns geometry bounds,
`stores.ts` owns state and persistence. `sidebarExpandedPreference` deliberately stays a
module-level mutable value rather than a store field, because it is a cross-store UI
preference, not session state.

Regenerating the layout fork invalidates nothing else: the 0.1.5 verify script asserts
`forkClient` sha256 and `npm run build:fork` rewrites `forks/ui-layout/lib/client.js` from
the 0.1.5 patches, so the active baseline self-heals.

## Remaining work

Both remaining forks need their 0.1.5 intent **re-authored in TypeScript**, not
mechanically re-applied. The mechanical port
(`scripts/port-fork-baseline.mjs`, which replays recorded layers onto the new upstream
and reports per-hunk whether a hunk still has a home) resolves 3 of 53 hunks for
`ui-workspace` and 5 of 19 for `ui-user-questions`; the rest have no home because the
0.2.0 sources restructured the surrounding code.

### Better Tasks' hard client contract

**Better Tasks' client half hard-depends on `ctx.uiWorkspace` — it is not an optional
lookup.** Do not treat `ui-workspace` as skippable:

```
src/client.js:1586  ctx.effect(() => ctx.uiWorkspace.onSessionCreated(…), …)   ← no optional chaining
src/client.js:1613  startSession: (…) => ctx.uiWorkspace.startSession(…)
src/client.js:1616  openSession:  (…) => ctx.uiWorkspace.openSession(…)
src/client.js:1654  ctx.inject(['uiWorkspace'], (scope) => mountSidebar(…))
```

The **native 0.2.0 `dsh-client-ui-workspace` has zero occurrences of
`onSessionCreated`** (`startSession` has nine). So under a native `ui-workspace` a
Better Tasks sidebar throws `TypeError` on mount and **the entire sidebar fails to
mount** — the user sees no sidebar at all, not a missing feature.

Consequences for the `ui-workspace` port:

- `onSessionCreated`, `startSession` and `openSession` must exist **literally** on the
  fork's `uiWorkspace` service. This is a harder acceptance item than any behaviour
  marker; `scripts/verify-forks-0.2.0.mjs` asserts all three on the built artifact.
- Keep the `betterTaskPins` **provider name** and `TaskPinIcon` literal — Better Tasks
  reads and provides those names.

### A boot check does not cover the client half

Measured, not hypothesised: a composition of Better Tasks 0.2.5 + the forked
`ui-layout` 0.2.0-rc.2 + the forked `ui-user-questions` 0.2.0-rc.2 + the **native**
`ui-workspace` passed the sandbox Host boot check cleanly —

```
boot check: PASS   rows disabled by gate: 0   entries still pending: 0   HTTP 200
```

— **while the client half in that same composition cannot mount the sidebar** (the
contract above). `verify-desktop-boot.ps1` proves Host activation: rows resolve, no
row is disabled, nothing pends. It executes no browser JavaScript, so a client-side
`TypeError` is invisible to it. Client-side acceptance needs either a real browser or
the artifact-level assertions this document describes.

### Assertion split: source patch vs artifact

Marker assertions must target the layer where the string actually survives:

- **Source-form markers** (constant declarations, type and export names) belong on the
  **src patch**. tsdown reflows whitespace: `export const SIDEBAR_MAX = 840` is in
  `src-patches/ui-layout/0.2.0-rc.2-better-tasks.patch` and is **absent from the built
  artifact** (0 occurrences). Asserting it on the artifact is a false failure.
- **Cross-package contract strings** (`questionSurface`, `data-question-surface`, the
  `'task-card'` variant, `onSessionCreated`, `TaskPinIcon`, …) belong on the **built
  artifact**, because that is what a host resolves at runtime.
- Root **slot children** (`"sidebar": {`, `"main": {`, `"rightbar": {`,
  `"shell.overlay": {`) belong on the built artifact: a downstream sidebar replacement
  mounts into `sidebar`, so losing a child silently detaches an occupant.

There is no byte baseline to compare against: the source route has no byte-identical
published twin (see the `fidelity` note in `provenance/source.lock.json`). Never use
`installed-client.js` as one. Byte stability is instead enforced by recording artifact
sha256 into `provenance/forks-<version>.lock.json` and re-checking it on every verify.

### The `todos` projection is DSH's, not Better Tasks'

The task card's todo list is a **DSH session projection**, and Better Tasks only
summarizes and renders it:

```
better-tasks src/client.js:1632  ctx.slots.inject('sidebar', … register({ name: 'sidebar' }))
better-tasks src/client.js:905   useSessions((s) => s)               ← slot-framework standard prop
better-tasks src/task-model.mjs:134 const summary = list.byId[id]
better-tasks src/task-model.mjs:113 const projections = summary.projectionValues
better-tasks src/task-model.mjs:121 todos: summarizeTodos(projections?.todos)
producer: @deepseek-ai/dsh-tool-todo/lib/index.js:81   key: "todos"
```

So `ui-workspace` and `ui-user-questions` are **not** in the todos chain (verified: 0
occurrences of `dsh-tool-todo` / `projectionValues` / `session-projection` /
`useSessions` / `useWorkspaces` in the built `ui-user-questions` artifact). The real
risk to todos is **Host side**: a stale core package hoisted into the profile disables
the rows that produce projections. Measured: Better Tasks' former
`@deepseek-ai/dsh-storage-domain` dependency left `session-projection-cache`
permanently pending — i.e. **silently losing todos**. The dependency discipline in
[§ Dependency coupling](#dependency-coupling) is the first line of defence for this
feature.

### `ui-workspace`

- **project appearance** — `/api/project-appearance`, the icon/colour picker dialog, the
  191-icon catalog, `ProjectAppearanceIcon`, `useProjectAppearances`, the workspace →
  appearance map threaded through `deriveFlat`, and the appearance entry in the
  `ProjectRowItem` menu.
- **activity range filter** — `setActivityRange` / `sessionInActivityRange` and the
  `all / 1d / 3d / 7d / 14d` entries in the view-options menu.
- **pin and New Session hooks** — `betterTaskPins`, `TaskPinIcon`,
  `startSession(workspaceId, beforeOpen)`, and the `onSessionCreated` /
  `notifySessionCreated` / `sessionCreatedListeners` lifecycle that the `pin-created`
  command hangs off.

Touches `src/client/`'s `tree.ts`, `stores.ts`, `navigation.ts`, `locales.ts`,
`rows/Rows.tsx`, `WorkspaceBrowser.tsx` and `index.ts`. The Host half of project
appearance already exists and is unchanged in `src/project-appearance.mjs`.

Marker assertions the current 0.1.5 verify script enforces, which a port must satisfy:
`betterTaskPins`, `setActivityRange`, `sessionInActivityRange`, `TaskPinIcon`,
`startSession(workspaceId, beforeOpen)`, `onSessionCreated(listener)`,
`this.notifySessionCreated(sessionId)`, `this.sessionCreatedListeners.clear()`.

### `ui-user-questions`

**Complete on the 0.2.0-rc.2 baseline.** The port adds a `questionSurface` seam
*alongside* 0.2's own `userQuestionPanels` seam (0.2 already solved cross-seat card
sharing, with a different contract), so this was an integration, not a rewrite:
`QuestionSurfaceRegistry` (one transient draft store + one settlement gate),
`QuestionSurface` publishing `data-question-surface`, and `registry.forget(...)` in
`answerQuestion`'s `finally`.

Two behaviour differences from the 0.1.5 fork, both deliberate — **do not "fix" them
back**, the reasons are in source comments:

1. **The surface's draft store is a separate, persist-free declaration**
   (`createQuestionSurfaceDraftStore`). `dsh-client-store` attaches persistence by
   `persist.name` alone, so a second live instance of the persisted composer
   declaration shares and cross-pollutes one `localStorage` entry. Consequence: a draft
   typed in the task card does not mirror into the composer seat (and vice versa).
   Shared settlement is preserved; shared drafts are not. Persistence was chosen over
   mirroring.
2. **No frozen wrapper around `PendingQuestion`.** 0.1.5's `guard()` returned a frozen
   object; `PendingQuestion` uses private fields, so `Object.create(pending)` cannot
   reach them, and a hand-forwarded class is not assignable to a class with privates.
   The gate is instead a callback (`gate.beginSettlement`) folded into 0.2's existing
   `locked` expression. Lost: the `Promise.reject('already settling')` path (a second
   surface now simply shows disabled controls).

One degradation, user-visible — **the most prominent difference in this delivery**:
`renderSlot: () => null` for host-mounted seats, so the plan-review **"preview in
sidebar" button is absent from the task card** (it still works in the composer seat).
`ui-slots` authorizes a `renderSlot` binding per **declaring entry**
(`SlotOwnershipError` for keys outside that entry's `children`,
`StaleAuthorizationError` after it is disposed), and a host-mounted surface renders
inside the host's own React tree, so it is structurally excluded. Five alternative
routes were evaluated and all reduce to that same ownership rule.

Assert with `node scripts/verify-forks-0.2.0.mjs` (see
[§ Assertion split](#assertion-split-source-patch-vs-artifact)): cross-package
contract strings on the built artifact, source-form markers on the src patch.

## Dependency coupling

`@veewo/dsh-better-tasks` 0.2.5 moved its two in-box imports from `dependencies` to
`peerDependencies` with a union range:

```json
"peerDependencies": {
  "@deepseek-ai/dsh-session-query": "^0.1.5-rc.2 || ^0.2.0-rc.1",
  "@deepseek-ai/dsh-storage-domain": "^0.1.5-rc.2 || ^0.2.0-rc.1"
}
```

Why this shape and not a version bump:

- As `dependencies`, pnpm hoists a copy into the profile. The Cordis loader resolves the
  core `storage-domain` row **from the profile**, so a stale hoisted copy makes the
  row-level preflight (`dsh-app-boot` `prepareProfileEntries` → `preflight`, which prints
  `disabling profile plugin row "…"`) **disable a core row**. Everything downstream then
  waits forever: `workspace` → `session-controller` → `ui-deliverables` →
  `better-tasks-sidebar`. The whole feature fails to start, it is not a cosmetic issue.
- Bumping to `0.2.0-rc.x` fixes the desktop line but **breaks the web line by the same
  mechanism in mirror**: the profile would hoist a 0.2.0 copy that the 0.1.5-rc.2 web
  runtime cannot satisfy, disabling the core `storage-domain` row there instead.
- `peerDependencies` install nothing (`autoInstallPeers: false` in the profile), so no
  local copy exists to shadow anything, and one artifact serves both lines.
- Both helpers are pure: `defineDomain(spec)` validates and returns `spec`,
  `domainTable(schema)` returns `{ valueSchema: schema }`. The stateful work already goes
  through injected services (`ctx.storageDomain.open`, `ctx.sessionQuery.readSession`).
- Because they are `@deepseek-ai/dsh-*` peers, the row-level gate now covers
  better-tasks itself. Previously it declared no such peer at all, so the gate was blind
  to it — that blindness was the root of the silent coupling.

`@deepseek-ai/schemastery` stays a `dependency` (a library, not an in-box service, and
not a row name). In the sandbox `^3.18.2` resolves to 3.18.4, identical to the app's own
copy, so there is no residual skew.

## Sandbox startup gate

Isolated `DSH_HOME`, profile `bt-020-test`, `nodeLinker: hoisted` unchanged,
`profiles/node_modules` junctioned to the real one (an isolated home otherwise cannot
resolve non-hoisted in-box peers and reports a false
`Cannot find package '@earendil-works/pi-ai'`).

```
dsh web: http://127.0.0.1:39177/?token=…
GET /  -> HTTP 200, 34481 bytes
  __DSH_BOOT__ present               : True
  boot manifest names layout/workspace/user-questions/better-tasks : True

rows disabled by gate : 0
did not activate      : 0
stderr                : clean (one Node fs.Stats deprecation warning)
listener after kill   : False
```

Positive activation evidence — the Host really ran better-tasks' domain open:

```
storages/better_tasks_pin_queue.json
{ "unit": { "name": "better_tasks_pin_queue", "version": 1 },
  "tables": { "queues": { "global": { "schemaVersion": 1, "revision": 0, "sessionIds": [] } } } }
```

That file is only written when the Host half calls
`ctx.storageDomain.open(pinQueueDomain)`, which needs the two peer imports to have
resolved.

## Gotchas

- **Do not use `app.asar` as a byte baseline.** The desktop app's packages were rebuilt
  locally, so they differ from the npm artifacts in CSS-hash seeds and embedded build
  paths only. `scripts/verify-app-baseline-equivalence.mjs` proves the two are the same
  program after normalization.
- **`nodeLinker: hoisted` must stay.** The desktop migration's version-pinning step
  (`overrides:` in the profile's `pnpm-workspace.yaml`) depends on it.
- **Never delete `~/.dsh/profiles/node_modules`.** It is the peer fallback root the
  desktop profile relies on, and it supplies `react`/`react-dom`, which the app's packed
  runtime does not ship.
- `dsh --profile desktop` is refused by design ("managed exclusively by the Electron
  application"); use a non-reserved profile name with `--port` for real Host boots.
