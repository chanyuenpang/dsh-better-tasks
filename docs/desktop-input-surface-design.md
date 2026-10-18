# Desktop 0.2 independent task composer adaptation

User explicitly requires in-card message, skill and command interaction, not a handoff to the main composer. The native 0.2 editor, trigger controller and popup are Session singletons. A second view over them is not a second input surface.

## Shared implementation contract

Extend exactly three workspace-local native Client forks: ui-input-trigger, ui-commands, ui-conversation. Keep Host skills/commands, real runtime installation, and the three previously accepted layout/workspace/questions forks unchanged.

In ui-input-trigger types, add an opaque `InputSurfaceToken` object (`readonly id: string`, identity is the object, not the string) and optional `ClientSessionContext.surface`. Add `InputSurfaceTarget` with:

- `signal: AbortSignal`
- `beginCommand(claim, span): boolean`, `insertText(text, span, continue?): boolean`, `insertReference(reference, span): boolean`
- `consumeToken(guard: ConsumeTokenRequest['guard']): boolean`
- `focus(): void`, `notify(level: 'info' | 'error', text: string): void`
- `isAvailable(): boolean` (not closing and no detached operation already in flight)
- `withOperation<T>(operation: () => T | Promise<T>): Promise<T>` (owns a Session lease until settlement, including popup callbacks)

`inputTriggers.createSurface(actx, token, target)` returns a fresh native InputTriggerController borrowing the existing source roster. It does not register Session-wide input listeners. Its source projections carry the token and all pick mutations target the supplied callbacks. It aborts/disposes with target.signal or the real binding generation. Roster changes reach native and detached controllers. Existing sessionOf behavior remains unchanged.

`commandUi.attachSurface(actx, token, target)` returns `{popup, View, dispose}`. Store token → exact real Session binding and target; never fall back to the native composer for unknown/disposed tokens. Reuse existing candidates, contributions, decorations, claims, Remote execution and notifications. Each token has its own native PopupSelectController. Route consume/focus/notices through that target. Popup business callbacks use withOperation. For detached bare commands, keep the draft until execution settles successfully, then CAS-consume the captured token; failure notifies this surface and does not prompt. Global dismiss reaches all popups.

Deliver native MenuView as the returned trigger controller's `View`, with an optional instance DOM-id prefix. The command surface handle also carries `View: PopupSelectView`. Existing native defaults remain backward compatible. Components cross these Service contracts, not new cross-package runtime imports.

`conversation.input.createSurface({sessionId, initialDraft?, signal?, defaultSink?})` returns Promise<ComposerSurfaceHandle>. Implementation is owned by ui-conversation and retains the real Session before awaiting ready/openState. It creates a fresh SessionInputShell (native Lexical editor + SubmitMachine), the above trigger and command surface handles, and no Session-wide mutation listeners or native draft mirror. Missing surface providers fail the optional feature, never core startup.

The handle exposes `sessionId`, guarded `input` (native SessionInput), `state`, `notices`, bound `View`, `dispose`, `closed: Promise<void>`, and `whenSettled()`. The internal trigger/popup remain owned by the surface. View props are `placeholder`, `defaultText`, `onDraftChange`, `submitLabel`, `disabled`, `className`. It reuses native DraftEditor/keymap/MenuView/PopupSelectView, keeping Enter/IME/claim semantics; BT owns only its card shell and business default sink. Menus use optional inline rendering and per-instance DOM IDs, leaving native defaults intact. DefaultSink receives `{binding,text,attachmentIds,mode,signal}` after adjudication/serialization; it is never the command executor. Input expansion does not steal the main editor's DOM root.

Surface disposal immediately invalidates menus and further user gestures, aborts pending creation/fetch, and defers final shell/reference release until admitted in-flight business callbacks settle. `SessionInput.submit` returns void, so a short sessions.using callback around submit is insufficient. Cleanup must be idempotent.

The native `/file` contribution must consult surface capability; this initial text/skill/command card surface does not offer attachment intake, so `/file` is hidden for that surface instead of opening the main composer's picker. Native behavior remains intact. No hidden fallback into another surface is permitted.

## Task-card ownership

Only first expansion creates a surface; never-opened hidden cards do not retain Sessions. Folding preserves the same handle/draft with `disabled=true`, closing transient menus. Running/unpin/unmount closes the handle, but the task manager subscribes through `closed` to collect a late restored draft. Reopening a closing surface waits for its final settlement rather than sharing a Lexical root or overwriting a newer draft.

Ordinary messages use the native `conversation.sendSession` transaction after fresh Session/generation/status checks. Only accepted messages inspect the latest `goals.get` CAS/activation and resume a non-complete, unarmed, budget-eligible goal. Goal failure is an informational/global warning, never a failed send or automatic resend. Commands bypass this business sink. Rename holds a real reference through ready and settlement.

The three original accepted fork archives are reused byte-for-byte. The three input forks have source patches and refreshed changed declarations; unchanged upstream inferred declarations are retained only when old/new declaration output is identical. Strict AST module-edge comparison uses vendored official 0.2.0-rc.2 artifacts; lexical and other non-platform dependencies remain inlined. The split conversation TS project must use its client config, not its empty reference-only root config.

## Verification boundary

Test shared Session with distinct surface tokens, unknown/disposed token rejection, stale draft revisions, independent popup state, candidate cancellation, references/skill serialization, command error without prompt fallback, operation lifetime through closing, and unchanged native path. Exact immutable candidate composition must pass the isolated installed-Electron startup gate before real installation. No real test prompts, runtime restart, geometry/pixel/screenshot QA, or user-setting rewrites.
