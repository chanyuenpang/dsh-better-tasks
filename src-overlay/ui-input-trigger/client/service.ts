/**
 * InputTriggerService (`ctx.inputTriggers`): the root half of the trigger pipeline — the
 * stateless source registry plus the per-session controller map. Every piece
 * of mutable interaction state (hit, menu, fetch) lives on the
 * {@link InputTriggerController}; the service only registers sources, resolves
 * controllers by session scope, and relays roster changes.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputSurfaceTarget, InputSurfaceToken, InputTriggerSource } from '../types.ts'
import { MenuView } from './MenuView.tsx'
import { InputTriggerController } from './controller.ts'
import type { InputTriggerServiceContract } from './contract.ts'

/**
 * All mutable service state in one holder: cordis service methods run behind
 * the caller-ctx tracker, so mutation goes through one property read — never
 * field assignment on `this`.
 */
interface LiveState {
  /** Registration order = menu group order = matchSpace/matchEnter poll order. */
  readonly sources: InputTriggerSource[]
  /** Per-session controllers; entries are deleted by their scope disposer. */
  readonly controllers: WeakMapWithValues<SessionBinding, InputTriggerController>
  readonly surfaces: Map<InputSurfaceToken, InputTriggerController>
  readonly usedTokens: WeakSet<InputSurfaceToken>
}

/** The `ctx.inputTriggers` trigger pipeline service (root registry + controller resolution). */
export class InputTriggerService extends Service implements InputTriggerServiceContract {
  static inject: string[] = ['sessions']

  private readonly live: LiveState = {
    sources: [], controllers: new WeakMapWithValues(), surfaces: new Map(), usedTokens: new WeakSet(),
  }

  /**
   * @param ctx - owning root context (the service registers itself as `slash`).
   */
  constructor(ctx: Context) {
    super(ctx, 'inputTriggers')
    ctx.on('locale/change', () => {
      for (const controller of this.controllers()) controller.refreshOpenMenu()
    })
  }

  /**
   * Register one trigger source. Live session controllers are notified so a
   * source arriving after scope birth still warms and joins the lexicon.
   * @param src - the source; (trigger, name) must be unique — duplicates throw.
   * @returns the disposer (callers wrap registration in ctx.effect). Disposal
   * while a controller shows the source's menu group drops that group.
   */
  registerSource(src: InputTriggerSource): () => void {
    const { live } = this
    if (live.sources.some(s => s.trigger === src.trigger && s.name === src.name)) {
      throw new Error(`slash source "${src.trigger}${src.name}" is already registered`)
    }
    live.sources.push(src)
    for (const controller of this.controllers()) {
      try {
        controller.sourceAdded(src)
      } catch (error) {
        // Contain faulty source callbacks (warm/subscribeLexicon): the
        // registration must stand with a usable disposer and the remaining
        // controllers must still be notified.
        console.error(`[ui-input-trigger] source "${src.trigger}${src.name}" late-registration setup failed:`, error)
      }
    }
    return () => {
      const at = live.sources.indexOf(src)
      if (at < 0) return
      live.sources.splice(at, 1)
      for (const controller of this.controllers()) controller.sourceRemoved(src)
    }
  }

  /**
   * Resolve the per-session controller for one session scope (lazy; the
   * scope disposer removes and disposes it). Construction warms the source
   * roster once — sessions are always agent-backed, so scope birth is the
   * single prewarm moment.
   * @param actx - session-scope ctx.
   * @returns the resident controller.
   * @throws when the Context no longer belongs to a retained Session generation.
   */
  sessionOf(actx: ClientContext): InputTriggerController {
    const sessions = this.sessions()
    const session = sessions.sessionOf(actx)
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId)
    if (binding === undefined || binding.session !== session) {
      throw new Error('slash.sessionOf requires a retained Session scope')
    }
    const id = binding.sessionId
    const { live } = this
    const existing = live.controllers.get(binding)
    if (existing !== undefined) return existing
    const controller = new InputTriggerController({
      actx: binding.ctx,
      sessionId: id,
      roster: {
        sources: trigger => live.sources.filter(s => s.trigger === trigger).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        all: () => live.sources,
      },
    })
    live.controllers.set(binding, controller)
    binding.ctx.effect(() => () => {
      controller.dispose()
      live.controllers.delete(binding)
    }, 'slash: session controller')
    return controller
  }

  /** Detached controllers borrow the roster but never the native editor or event route. */
  createSurface(actx: ClientContext, token: InputSurfaceToken, target: InputSurfaceTarget): InputTriggerController & { readonly View: typeof MenuView } {
    const sessions = this.sessions()
    const session = sessions.sessionOf(actx)
    const binding = session === undefined ? undefined : sessions.binding(session.sessionId)
    if (binding === undefined || binding.session !== session) throw new Error('slash.createSurface requires a retained Session scope')
    if (target.signal.aborted || typeof token !== 'object' || token === null || this.live.usedTokens.has(token)) {
      throw new Error('input surface token is closed or already used')
    }
    this.live.usedTokens.add(token)
    const controller = Object.assign(new InputTriggerController({
      actx: binding.ctx, sessionId: binding.sessionId, surface: { token, target },
      roster: {
        sources: trigger => this.live.sources.filter(s => s.trigger === trigger).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        all: () => this.live.sources,
      },
    }), { View: MenuView })
    const originalDispose = controller.dispose.bind(controller)
    let closed = false
    let removeBinding: (() => unknown) | undefined
    let removeOwner: (() => unknown) | undefined
    controller.dispose = () => {
      if (closed) return
      closed = true
      target.signal.removeEventListener('abort', controller.dispose)
      this.live.surfaces.delete(token)
      const releaseBinding = removeBinding
      const releaseOwner = removeOwner
      removeBinding = removeOwner = undefined
      try { originalDispose() } finally {
        try { void releaseBinding?.() } finally { void releaseOwner?.() }
      }
    }
    this.live.surfaces.set(token, controller)
    target.signal.addEventListener('abort', controller.dispose, { once: true })
    try {
      removeBinding = binding.ctx.effect(() => controller.dispose, 'slash: input surface')
      removeOwner = this.ctx.effect(() => controller.dispose, 'slash: surface provider lifetime')
      if (target.signal.aborted) throw new Error('input surface closed during creation')
      return controller
    } catch (error) {
      controller.dispose()
      throw error
    }
  }

  private controllers(): InputTriggerController[] {
    return [...this.live.controllers.values, ...this.live.surfaces.values()]
  }

  private sessions(): ISessions {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('ui-input-trigger: sessions service unavailable')
    return sessions
  }
}
