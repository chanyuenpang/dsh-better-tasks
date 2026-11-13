import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerSurfaceViewProps } from '../contract/input-surface.ts'
import type { SurfaceViewModel } from './surface.ts'
import { DraftEditor } from './editor/DraftEditor.tsx'
import { registerComposerKeymap } from './editor/keymap.ts'
import css from './InputSurfaceView.module.css'

/** Original compact card face over the independent native editor and command pipeline. */
export function InputSurfaceView({ surface, placeholder = '', defaultText, onDraftChange, submitLabel, addLabel, searchLabel, emptyLabel, errorLabel, inputLabel, disabled = false, className }: ComposerSurfaceViewProps & { surface: SurfaceViewModel }): ReactNode {
  const shell = surface.shell
  const state = useSyncExternalStore(shell.state.subscribe, shell.state.getSnapshot)
  const notice = useSyncExternalStore(shell.notices.subscribe, shell.notices.getSnapshot)
  const gate = useSyncExternalStore(surface.gate.subscribe, surface.gate.getSnapshot)
  const menu = useSyncExternalStore(surface.trigger.menu.subscribe, surface.trigger.menu.getSnapshot)
  const launcher = useSyncExternalStore(surface.trigger.launcher.subscribe, surface.trigger.launcher.getSnapshot)
  const scroll = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const searchComposing = useRef(false)
  const composingUntil = useRef(0)
  const [query, setQuery] = useState('')
  const [dismissedNotice, setDismissedNotice] = useState<number | undefined>()
  // Dismiss a captured old sequence at user gestures, never on programmatic
  // optimistic clear/failed-draft restore (which may arrive with a newer notice).
  const visibleNotice = notice !== null && notice.seq !== dismissedNotice ? notice : null
  const busy = state.phase === 'adjudicating' || state.phase === 'submitting'
  const locked = disabled || gate.disabled || busy
  const launched = menu.open && launcher !== null
  const latest = useRef({ locked, defaultText })
  latest.current = { locked, defaultText }
  const composing = (): boolean => searchComposing.current || Date.now() < composingUntil.current || shell.editor.isComposing()
  const dismissNotice = (): void => { setDismissedNotice(notice?.seq) }
  const send = (mode: 'queue' | 'steer', source: 'click' | 'enter'): void => {
    if (locked || !surface.canInteract() || composing()) return
    dismissNotice()
    surface.submit(defaultText, mode, source)
  }
  useLayoutEffect(() => {
    surface.setDisabled(disabled)
    return () => { surface.setDisabled(true) }
  }, [surface, disabled])
  useEffect(() => { onDraftChange?.(state.draft) }, [state.draft, onDraftChange])
  useLayoutEffect(() => {
    if (launched) search.current?.focus()
    else { setQuery(''); searchComposing.current = false; composingUntil.current = 0 }
    // Closing by outside pointer/disable/popup handoff must not steal focus.
  }, [launched])
  useEffect(() => registerComposerKeymap(shell.editor, {
    arbitrate: (key, inComposition) => latest.current.locked ? 'pass' : shell.arbitrate(key, inComposition),
    space: () => !latest.current.locked && shell.space(),
    dismissPopup: () => shell.dismissPopup(),
    canSubmit: () => !latest.current.locked && surface.canInteract(),
    submit: accelerated => { setDismissedNotice(shell.notices.getSnapshot()?.seq); surface.submit(latest.current.defaultText, accelerated ? 'steer' : 'queue', 'enter') },
    intakeFiles: () => shell.notify('error', surface.translate('attachment.dropBlocked')),
    pasteText: text => { if (!latest.current.locked) { setDismissedNotice(shell.notices.getSnapshot()?.seq); shell.paste(text) } },
  }), [shell, surface])
  const restoreAfterPick = (): void => {
    if (surface.command.popup.state?.getSnapshot().open || surface.trigger.menu.getSnapshot().open) return
    const active = document.activeElement
    // A command may intentionally open another dialog. Never take its focus back.
    if (active === document.body || active === search.current || host.current?.contains(active)) shell.focus()
  }
  const pick = (source: string, index: number, action?: 'pick' | 'drill'): void => {
    if (locked || !surface.canInteract() || composing()) return
    const revision = shell.snapshot.draftRev
    surface.trigger.pick(source, index, action)
    if (shell.snapshot.draftRev !== revision || shell.snapshot.phase === 'claimed') dismissNotice()
    restoreAfterPick()
  }
  const searchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composing()) return
    if (event.key === 'Enter' && event.repeat) { event.preventDefault(); event.stopPropagation(); return }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      surface.trigger.dismiss(); shell.focus(); return
    }
    const key = event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowUp' ? 'up'
      : event.key === 'Enter' ? 'enter' : event.key === 'Tab' ? event.shiftKey ? 'tabBack' : 'tab' : undefined
    if (key === undefined) return
    // Enter is selection-only, but an empty list must not trap forward Tab.
    event.stopPropagation()
    if (locked || !surface.canInteract()) { if (key !== 'tab') event.preventDefault(); return }
    const revision = shell.snapshot.draftRev
    const result = shell.arbitrate(key, false)
    if (key === 'tab' && result === 'pass') { surface.trigger.dismiss(); return }
    event.preventDefault()
    if (shell.snapshot.draftRev !== revision || shell.snapshot.phase === 'claimed') dismissNotice()
    if (result === 'pick-highlighted' || key === 'tabBack') restoreAfterPick()
  }
  const toggle = (): void => {
    if (locked || !surface.canInteract() || composing()) return
    if (menu.open) { surface.trigger.dismiss(); shell.focus(); return }
    setQuery(''); surface.launchMenu()
  }
  const MenuView = surface.trigger.View
  const PopupView = surface.command.View
  const groups = menu.groups ?? []
  const failed = groups.some(group => group.failed === true)
  const empty = groups.length > 0 && groups.every(group => group.status === 'ready' && !group.failed && group.items.length === 0)
  const add = addLabel ?? surface.translate('input.commands')
  const searchText = searchLabel ?? `${surface.menuTranslate('skill')} / ${surface.menuTranslate('command')}`
  return <div ref={host} className={css.host} data-input-surface={surface.id}>
    <div className={[css.surface, className].filter(Boolean).join(' ')} data-composer-card>
      <div onBeforeInputCapture={dismissNotice} onInputCapture={dismissNotice}
        onPointerDown={() => { if (launched) surface.trigger.dismiss() }}>
      <DraftEditor classNames={css} editor={shell.editor} scrollRef={scroll}
        editable={!locked} editorDisabled={locked} phase={state.phase}
        placeholderText={placeholder} ariaLabel={inputLabel ?? (placeholder || surface.translate('input.send'))}
        workspaceTrigger={false} workspacePickerOpen={false} onWorkspaceKeyDown={() => {}}
        hint={(state.phase === 'claimed' || state.phase === 'submitting') && state.claim !== undefined && state.draft.startsWith(state.claim.token) && state.draft.slice(state.claim.token.length).trim() === '' ? state.claim.hint ?? null : null} showPlaceholder={state.draft === ''} />
      </div>
      <div className={css.picker} hidden={!menu.open} id={`${surface.id}-picker`} role="dialog" aria-label={searchText} data-no-card-drag>
        {launched && <input ref={search} className={css.search} value={query} placeholder={searchText} aria-label={searchText}
          role="combobox" aria-expanded={menu.open} aria-controls={`${surface.id}-listbox`}
          aria-activedescendant={menu.highlight == null ? undefined : `${surface.id}-${menu.highlight.source}-${menu.highlight.index}`}
          disabled={locked} onChange={event => { const value = event.target.value; setQuery(value); surface.filterMenu(value) }}
          onCompositionStart={() => { searchComposing.current = true }}
          onCompositionEnd={() => { searchComposing.current = false; composingUntil.current = Date.now() + 10 }} onKeyDown={searchKey} />}
        <MenuView menu={surface.trigger.menu} headers={surface.trigger.headers} onPick={pick}
          onCrumb={(source: string, index: number) => { if (!locked && surface.canInteract() && !composing()) surface.trigger.pickCrumb(source, index) }}
          onHover={(source: string, index: number) => surface.trigger.hover(source, index)}
          onDismiss={() => surface.trigger.dismiss()} t={surface.menuTranslate} idPrefix={surface.id} inline />
        {empty && <div className={css.status} role="status">{emptyLabel ?? surface.commandTranslate('status.empty')}</div>}
        {failed && <div className={css.status} role="alert">{errorLabel ?? 'Unable to load suggestions'}</div>}
      </div>
      <div className={css.popup} data-input-popup data-no-card-drag><PopupView popup={surface.command.popup} t={surface.commandTranslate} inline /></div>
      <div className={css.actions}>
        <Tooltip label={add} side="top" delayMs={500}>
          <button type="button" className={css.add} aria-label={add} aria-haspopup="dialog" aria-expanded={menu.open}
            aria-controls={`${surface.id}-picker`} disabled={locked} onMouseDown={event => event.preventDefault()} onClick={toggle}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
        </Tooltip>
        <Tooltip label={submitLabel ?? surface.translate('input.send')} side="top" delayMs={500}>
          <button type="button" className={css.send} aria-label={submitLabel ?? surface.translate('input.send')}
            disabled={locked || (state.draft.trim() === '' && !defaultText?.trim())}
            onMouseDown={event => event.preventDefault()} onClick={() => send('queue', 'click')}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path fill="currentColor" d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" /></svg>
          </button>
        </Tooltip>
      </div>
    </div>
    {visibleNotice !== null && <div className={css.notice} role={visibleNotice.level === 'error' ? 'alert' : 'status'}>{visibleNotice.text}</div>}
    {gate.reason !== undefined && <div className={css.notice} role="status">{gate.reason}</div>}
  </div>
}
