import type { Context } from '@deepseek-ai/cordis'
import { createElement, type ComponentType } from 'react'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ISessions, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { ComposerSurfaceHandle, ComposerSurfaceOptions, ComposerSurfaceViewProps } from '../contract/input-surface.ts'
import type { InputTriggerController, SessionInput, DraftAttachmentId, SubmitOutcome } from '../contract/input.ts'
import type { ComposerBlocks } from '../contract/composer-blocks.ts'
import type { InputSurfaceTarget, InputSurfaceToken } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from './facade.ts'
import { createSurfaceLifetime } from './surface-lifetime.ts'
import { InputSurfaceView } from './InputSurfaceView.tsx'

/** Views travel through services, never runtime imports of another Client plugin. */
export interface SurfaceTrigger extends InputTriggerController {
  readonly View: ComponentType<any>
  readonly menu: ObservableSnapshot<{ readonly open: boolean; readonly highlight?: { source: string; index: number } | null; readonly groups: readonly { status: string; failed?: boolean; items: readonly unknown[] }[] }>
  toggleAll(hit: Parameters<InputTriggerController['toggleSource']>[1]): void
  filterLauncher(query: string): void
  readonly headers: ObservableSnapshot<unknown>
  pick(source: string, index: number, action?: 'pick' | 'drill'): void
  pickCrumb(source: string, index: number): void
  hover(source: string, index: number): void
  dismiss(): void
  dispose(): void
}
export interface SurfaceCommand {
  readonly popup: { readonly state?: ObservableSnapshot<{ open: boolean }>; dismiss(options?: { focusComposer?: boolean }): void }
  readonly View: ComponentType<any>
  dispose(): void
}
interface TriggerProvider {
  createSurface(actx: Context, token: InputSurfaceToken, target: InputSurfaceTarget): SurfaceTrigger
}
interface CommandProvider {
  attachSurface(actx: Context, token: InputSurfaceToken, target: InputSurfaceTarget): SurfaceCommand
}
interface ConversationSink {
  readonly blocks: ComposerBlocks
  sendSession(session: SessionFace, text: string, attachmentIds: readonly DraftAttachmentId[], mode: 'queue' | 'steer', signal?: AbortSignal): Promise<SubmitOutcome>
}
interface StatusSource {
  getSnapshot(): ReadonlyMap<string, { running?: boolean; pendingInteraction?: unknown }>
  subscribe(fn: () => void): () => void
}
export interface SurfaceViewModel {
  readonly shell: SessionInputShell
  readonly trigger: SurfaceTrigger
  readonly command: SurfaceCommand
  readonly id: string
  readonly gate: ObservableSnapshot<{ disabled: boolean; running: boolean; reason?: string }>
  readonly menuTranslate: (...args: any[]) => string
  readonly commandTranslate: (...args: any[]) => string
  readonly translate: (...args: any[]) => string
  submit(defaultText?: string, mode?: 'queue' | 'steer', source?: 'click' | 'enter'): void
  canInteract(): boolean
  setDisabled(disabled: boolean): void
  launchMenu(source?: string): void
  filterMenu(query: string): void
}

let surfaceSequence = 0

/** Create an independently owned editor over one exact, retained Session generation. */
export async function createInputSurface(root: Context, options: ComposerSurfaceOptions): Promise<ComposerSurfaceHandle> {
  const sessions = root.get('sessions') as ISessions | undefined
  const triggers = root.get('inputTriggers') as unknown as TriggerProvider | undefined
  const commands = root.get('commandUi') as unknown as CommandProvider | undefined
  const locale = root.get('locale')
  const ui = root.get('uiSession') as { sessionStatus: StatusSource } | undefined
  const conversation = root.get('conversation') as unknown as ConversationSink | undefined
  if (sessions === undefined || typeof triggers?.createSurface !== 'function'
    || typeof commands?.attachSurface !== 'function' || locale === undefined || ui === undefined || typeof conversation?.sendSession !== 'function') {
    throw new Error('Independent input surfaces are unavailable')
  }
  options.signal?.throwIfAborted()
  const reference = sessions.retain(options.sessionId, { source: 'controllerOperation', signal: options.signal })
  let handedOff = false
  try {
    const binding = await reference.ready
    options.signal?.throwIfAborted()
    const state = binding.session.getSnapshot()
    if (state.openState !== 'open' || state.removed) throw state.openError ?? new Error('Session is not open')
    const token: InputSurfaceToken = Object.freeze({ id: `dsh-input-surface-${++surfaceSequence}` })
    const interaction = new AbortController()
    const gate = createSnapshotStore<{ disabled: boolean; running: boolean; reason?: string }>({ disabled: false, running: state.running })
    const blocks = (conversation.blocks as ComposerBlocks).storeFor(binding.sessionId)
    let shell: SessionInputShell | undefined
    let trigger: SurfaceTrigger | undefined
    let command: SurfaceCommand | undefined
    let viewDisabled = false
    const disposers: Array<() => void> = []
    let removeOwner: (() => unknown) | undefined
    let removeGeneration: (() => unknown) | undefined
    const basicRefusal = (): string | undefined => {
      const snapshot = binding.session.getSnapshot()
      if (sessions.binding(binding.sessionId) !== binding || snapshot.removed || snapshot.openState !== 'open') return 'Session is unavailable'
      if (ui.sessionStatus.getSnapshot().get(binding.sessionId)?.pendingInteraction != null) return 'Session is awaiting an interaction'
      if (snapshot.subagent?.address.mode === 'continuable' && snapshot.subagent.parentAvailable !== true) return 'Parent Session is unavailable'
      return undefined
    }
    const publishGate = () => {
      const reason = basicRefusal()
      // A new business refusal or caller lock revokes transient UI, but an
      // operation's own flight count must not dismiss its in-flight popup.
      if (viewDisabled || reason !== undefined) { trigger?.dismiss(); command?.popup.dismiss() }
      gate.set({ disabled: viewDisabled || lifetime.closing || lifetime.flights !== 0 || reason !== undefined,
        running: binding.session.getSnapshot().running, ...(reason === undefined ? {} : { reason }) })
    }
    const lifetime = createSurfaceLifetime({
      changed: publishGate,
      close: () => {
        interaction.abort(new Error('Input surface closed'))
        command?.dispose()
        trigger?.dispose()
        for (const dispose of disposers.splice(0)) dispose()
        options.signal?.removeEventListener('abort', onAbort)
      },
      release: () => {
        try { shell?.dispose() } finally {
          reference.release()
          void removeOwner?.()
          void removeGeneration?.()
        }
      },
    })
    const onAbort = () => lifetime.dispose()
    const canInteract = () => !viewDisabled && lifetime.isAvailable() && basicRefusal() === undefined
    const target: InputSurfaceTarget = {
      signal: interaction.signal,
      beginCommand: (claim, span) => !lifetime.closing && shell?.beginCommand(claim, span) === true,
      insertText: (text, span, keep, fromLauncher) => !lifetime.closing && shell?.insertText(text, span, keep, fromLauncher) === true,
      insertReference: (value, span) => !lifetime.closing && shell?.insertReference(value, span) === true,
      consumeToken: guard => !lifetime.closing && shell?.consumeToken(guard) === true,
      focus: () => { if (!lifetime.closing) shell?.focus() },
      notify: (level, text) => { if (!lifetime.closing) shell?.notify(level, text) },
      isAvailable: canInteract,
      withOperation: operation => lifetime.withOperation(operation),
    }
    const t = locale.bind('conversation')
    try {
      shell = new SessionInputShell({
        actx: binding.ctx,
        withOperation: operation => lifetime.withOperation(operation),
        inputTriggers: () => trigger,
        popup: () => command?.popup,
        inbox: binding.session.projections.faceOf('inbox') as ObservableSnapshot<InboxState | undefined>,
        defaultSink: async (text, attachmentIds, mode, signal) => {
          // Adjudication/reference serialization can await. Recheck immediately before admission.
          signal.throwIfAborted()
          if (lifetime.closing || viewDisabled) throw new Error('Input surface closed or disabled before admission')
          const refusal = basicRefusal() ?? blocks.getSnapshot()?.reason
          if (refusal !== undefined) throw new Error(refusal)
          if (attachmentIds.length !== 0) throw new Error('This input surface accepts text only')
          if (options.defaultSink !== undefined) return options.defaultSink({ binding, text, attachmentIds, mode, signal })
          return conversation.sendSession(binding.session, text, attachmentIds, mode, signal)
        },
        commandAttachments: {
          serialize: async ids => { if (ids.length !== 0) throw new Error('This input surface accepts text only'); return [] },
          release: () => {},
          unsupportedNotice: token => t('command.attachmentsUnsupported', { command: token.trim().replace(/^\//u, '') }),
        },
      })
      command = commands.attachSurface(binding.ctx, token, target)
      trigger = triggers.createSurface(binding.ctx, token, target)
      if (typeof command.View !== 'function' || typeof trigger.View !== 'function') throw new Error('Input surface views are unavailable')
      if (options.initialDraft !== undefined) shell.setDraft(options.initialDraft)
      const ownedShell = shell
      const submit = (defaultText?: string, mode: 'queue' | 'steer' = 'queue', source?: 'click' | 'enter') => {
        if (!canInteract()) return
        if (ownedShell.snapshot.phase === 'adjudicating' || ownedShell.snapshot.phase === 'submitting') return
        if (ownedShell.snapshot.draft.trim() === '' && defaultText?.trim()) ownedShell.setDraft(defaultText)
        ownedShell.submit(mode, source)
      }
      const model: SurfaceViewModel = { shell, trigger, command, id: token.id, gate,
        menuTranslate: locale.bind('slash.menu'), commandTranslate: locale.bind('command'), translate: t,
        submit, canInteract,
        setDisabled: disabled => { if (viewDisabled === disabled) return; viewDisabled = disabled; publishGate() },
        launchMenu: source => {
          if (!canInteract()) return
          // Match InputBar's combobox launch ordering: restore this editor's
          // focus/selection before tracking the launcher, never the main input.
          ownedShell.dismissPopup()
          ownedShell.focus()
          const span = { ...ownedShell.caretSpan(), draftRev: ownedShell.snapshot.draftRev }
          const hit = { trigger: '/' as const, query: '', quoted: false,
            position: ownedShell.snapshot.draft.slice(0, span.start).trim() === '' ? 'leading' as const : 'inline' as const, span }
          if (source === undefined) trigger!.toggleAll(hit)
          else trigger!.toggleSource(source, hit)
        },
        filterMenu: query => { if (canInteract()) trigger!.filterLauncher(query) },
      }
      const input: SessionInput = {
        state: shell.state,
        setDraft: text => { if (canInteract()) ownedShell.setDraft(text) },
        beginCommand: (claim, span) => canInteract() && ownedShell.beginCommand(claim, span),
        insertReference: (value, span) => canInteract() && ownedShell.insertReference(value, span),
        addAttachments: () => false,
        removeAttachment: () => false,
        pruneAttachments: () => {},
        submit: (mode, source) => submit(undefined, mode, source),
        notify: target.notify,
        focus: target.focus,
      }
      const handle: ComposerSurfaceHandle = {
        sessionId: binding.sessionId, input, state: shell.state, notices: shell.notices,
        View: (props: ComposerSurfaceViewProps) => createElement(InputSurfaceView, { ...props, surface: model }),
        closed: lifetime.closed, whenSettled: lifetime.whenSettled, dispose: lifetime.dispose,
      }
      disposers.push(binding.session.subscribe(publishGate), ui.sessionStatus.subscribe(publishGate), blocks.subscribe(publishGate))
      options.signal?.addEventListener('abort', onAbort, { once: true })
      removeOwner = root.effect(() => () => lifetime.dispose(), 'conversation: detached input surface')
      removeGeneration = binding.ctx.effect(() => () => lifetime.dispose(), 'conversation: detached input generation')
      handedOff = true
      publishGate()
      if (options.signal?.aborted) lifetime.dispose()
      return handle
    } catch (error) {
      lifetime.dispose()
      handedOff = true // lifetime owns the one release, including partial construction
      throw error
    }
  } finally {
    if (!handedOff) reference.release()
  }
}
