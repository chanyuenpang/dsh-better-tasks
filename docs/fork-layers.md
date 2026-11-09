# Fork layers: the a layer and the b layer

Better Tasks replaces six app-owned Client UI modules
(`ui-layout`, `ui-workspace`, `ui-user-questions`, `ui-input-trigger`, `ui-commands`,
`ui-conversation`). Each fork is deliberately split into two layers, and the split is
the thing that makes a dsh upgrade mechanical rather than archaeological.

| layer | what it is | where it lives | what an upgrade does to it |
|---|---|---|---|
| **b layer** | pristine upstream source | staged from the pinned tag by `build-forks-from-source.mjs --stage` | re-copied, never edited |
| **a layer** | everything we wrote | `src-overlay/<slug>/**` + the small hunks in `src-patches/<slug>/*.patch` | read by the contract checker, not merged |

The build order is **stage upstream → overlay → patches**. Overlay must come first:
a recorded patch may edit a file that only exists because our layer put it there.

---

## Where our code goes

### 1. New files — `src-overlay/<slug>/<package-relative path>`

Files that do not exist upstream at all: `surface.ts`, `surface-lifetime.ts`,
`InputSurfaceView.tsx`, `question-surface.ts`, `surface-card.tsx`,
`project-appearance.tsx`, `activity-range.ts`, `AnimatedRows.tsx`,
`ForkSession.tsx`, `SessionId.tsx`, `region-boundary.tsx` (three copies).

These **cannot conflict on a forward**: upstream never touches a path it does not own.
Their only upgrade cost is the imports they take from upstream, which is what
`scripts/check-upstream-contract.mjs` measures.

### 2. Takeovers — `src-overlay/<slug>/<path of an upstream module>`

Our change is not a seam inside the upstream module but a rewrite of its own
algorithm, so the whole module moves into our layer:

```
ui-commands         client/service.ts
ui-conversation     client/input/facade.ts
ui-input-trigger    client/controller.ts, client/service.ts
ui-user-questions   client/index.ts, client/QuestionComposer.tsx
ui-workspace        client/navigation.ts, client/tree.ts,
                    client/rows/Rows.tsx, client/rows/WorkspaceBrowser.tsx
```

A takeover **never conflicts either**, because upstream's copy is simply replaced at
build time — but that is exactly why it needs its own alarm: upstream's improvements
to that module stop reaching us silently. The contract checker therefore reports
every takeover whose upstream source changed between the two tags:

```
whole-module takeovers (10):
  REVIEW packages/client/ui-workspace/src/client/tree.ts
      upstream changed this module: re-apply our version against the new upstream one
```

**REVIEW is work, not a failure.** The forward still builds; the item tells you that
one module needs a human diff against upstream before the release is honest.

### 3. Patches — `src-patches/<slug>/<version>-better-tasks.patch`

The residue: hunks that must live inside an upstream file we do not want to take
over. These are the only things a forward can actually conflict on, so the goal is
to keep this list short and every entry explainable. See
[the exception list](#the-exception-list).

---

## What a forward costs, by layer

| change type | conflict possible | cost |
|---|---|---|
| our new file | no | re-check its upstream imports |
| our takeover | no | re-diff it against upstream if upstream moved |
| our patch hunk | **yes** | manual merge |

Measured on the 0.2.1-rc.2 → 0.2.2-rc.1 line, before the split: 48 touched files,
200 hunks, 32 of them upstream files — 13 of which conflicted under a three-way merge
(38 conflicted hunks). After the split: **26 a-layer files with zero conflict surface
plus 22 patched upstream files / 77 hunks**, all of them registration-level or small
declaration edits.

---

## The exception list

Every remaining patch hunk, and why it cannot become an overlay file.

The rule of thumb: a patch stays when taking the module over would be **more**
dangerous than patching it, because upstream keeps growing the file and a takeover
would silently drop those additions.

| file | hunks | delta | why it stays a patch |
|---|---|---|---|
| `ui-layout/client/stores.ts` | 4 | +54 / -10 | sidebar width persistence; must share the module-level `sidebarExpandedPreference` with `AppFrame.tsx`, which stays upstream |
| `ui-workspace/client/locales.ts` | 11 | +34 / -2 | dictionary tables: upstream **added six locales** in this line alone. A takeover would drop every future language. Pure addition, zero conflict risk. |
| `ui-user-questions/client/draft-store.ts` | 1 | +31 / -17 | one hunk reworking the persisted-draft declaration inside the upstream store factory |
| `ui-commands/client/PopupSelectView.tsx` | 8 | +24 / -4 | IME/composition key handling; a small view file upstream still edits |
| `ui-user-questions/client/PlanReviewPanel.tsx` | 3 | +21 / -13 | severity/notice copy and layout |
| `ui-input-trigger/types.ts` | 2 | +20 / -1 | the public surface token/target types other packages import; keeping them in the upstream type module preserves declaration merging |
| `ui-layout/client/columns.ts` | 3 | +15 / -3 | geometry constants (`SIDEBAR_MAX = 840`, `sidebarMax`) that `AppFrame.tsx` and `stores.ts` both read |
| `ui-workspace/client/index.ts` | 5 | +15 / -3 | the plugin's `apply()` wiring: reveal/notification hooks and the appearance menu registration |
| `ui-user-questions/client/contract/slots.ts` | 7 | +14 / -6 | slot contract types; merges with the `SlotMap` declaration merging upstream maintains |
| `ui-input-trigger/client/MenuView.tsx` | 8 | +12 / -11 | combined-launcher and composition-frame rendering |
| `ui-input-trigger/core/contract.ts` | 1 | +9 / -3 | the trigger hit contract both halves share |
| `ui-commands/client/contract.ts` | 2 | +9 / -1 | service-face declaration the other packages import |
| `ui-input-trigger/core/menu.ts` | 2 | +7 / -5 | menu reducer: combined-slash source |
| `ui-workspace/client/stores.ts` | 5 | +6 / 0 | `setActivityRange` action, added to the upstream store declaration |
| `ui-conversation/client/input/hub.ts` | 2 | +6 / 0 | exposes `createSurface` on the hub service |
| `ui-input-trigger/client/contract.ts` | 2 | +4 / -1 | controller face extension |
| `ui-conversation/client/apply.ts` | 2 | +4 / -4 | surface-lifetime wiring into the session shell |
| `ui-input-trigger/client/index.ts` | 3 | +3 / -2 | plugin registration |
| `ui-layout/client/AppFrame.tsx` | 2 | +2 / -1 | restore the persisted width and wrap the frame in the region boundary |
| `ui-layout/client/index.ts` | 2 | +2 / -1 | wrap the root registration in the region boundary |
| `ui-conversation/client/contract/input.ts` | 1 | +2 / 0 | `SurfaceTrigger`/`SurfaceCommand` contract members |
| `ui-conversation/client/index.ts` | 1 | +2 / 0 | export the new contract types |

`test/fork-layer-split.test.mjs` enforces the shape: no patch may create a file, and
the library may not grow past 90 hunks / 25 patched upstream files without the test
failing.

---

## Checking whether a forward still fits

```powershell
npm run check:contract -- --from-tag <old-dsh-version> --to-tag <new-dsh-version>
```

The checker observes only what the a layer actually touches:

1. the upstream internal modules our files import — existence, byte equality, and the
   delta of exports **we actually bind** (a module dropping an export we never import
   is reported as information, not as breakage);
2. the public extension surface we attach to — every declared slot key and kind,
   the `ctx.layout` method set, the `dsh.client.*` manifest fields, the
   `ISessions` contract members;
3. which of our files each drift item puts at risk;
4. every whole-module takeover whose upstream source moved.

It does not diff the repository: a change to a package we never touch is not our
problem. `--from` must be the tag the a layer was written against
(`provenance/source.lock.json`); the checker warns when it is not.

Verdicts:

- **attachable** — forward, build, run the startup gate, package. No merge needed.
- **incompatible** — a module vanished or lost an export we use. Fix the a layer;
  never the report. The output names the files to edit.
- **REVIEW** entries — the forward is still fine, but a takeover needs a human diff.

---

## Why not fork the whole application

Forking all of dsh would move the same merge work into a 3,100-file /
496k-line monorepo and add Electron packaging, code signing and an update feed —
while losing the removable-plugin shape. Measured, the conflicts live in the same
places either way, so the split above is what buys the reduction, not the fork size.
