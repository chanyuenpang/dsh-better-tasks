# Desktop 0.2.12 — task-panel follow-up batch

## Scope and status

User accepted 0.2.11 after restarting. This batch contains only the requested follow-up:

- Unpin color derives from the actual card background (80%) and its state tone (20%); current-card backgrounds, official glyph and behavior remain unchanged.
- Final Markdown locally rebinds the native body/heading/table/code font tokens to task detailFontSize. Native typography hierarchy and copy controls remain, without changing the accepted input UI.
- Ordinary Ask User Question options render inside task cards through an optional native question surface. Card and composer use the SAME per-Session persisted draft instance and shared settlement gate. Card size follows task detailFontSize; background cards do not autofocus. Plan-review approval remains in the native panel rather than displaying a misleading summary-only approval surface.
- Approved process-wide Desktop animation preference is prepared for the existing Desktop, Start Menu and pinned taskbar shortcuts. No new local animation CSS override, no repeated Windows setting writes and no RDP configuration change.

**Installed 0.2.12; user-controlled restart and closeout confirmed.** Plugin Manager originally reported `restart-required`; the user subsequently reported “重启了，没问题就收尾。动画已经动了”. Animation recovery after restart is therefore user-confirmed, no additional issues were reported, and the user requested closeout. This is not a claim of exhaustive automated feature/visual verification.

The one startup-only sandbox gate passed and was cleaned up before installation. Installed archive/client hashes and the complete 211-package graph match the cold-started composition; unrelated user settings/dependencies were preserved. All three approved launch shortcuts contain the motion preference, with their other properties preserved and originals backed up. The agent did not restart the real Desktop. The plan was already completed at handoff; no reopening, extra validation or new changes are needed for this acceptance record.

Evidence: [startup](<sandbox/.desktop-ui-polish-0212/enabled.acceptance.json>), [cleanup](<sandbox/.desktop-ui-polish-0212/cleanup.acceptance.json>), [preinstall consistency](<releases/0.2.12-desktop-ui-polish/preinstall-consistency.json>), [installed artifacts](<releases/0.2.12-desktop-ui-polish/installed-verification.json>), [complete dependency graph](<releases/0.2.12-desktop-ui-polish/dependency-graph-verification.json>), [launcher preference](<releases/0.2.12-desktop-ui-polish/motion-launchers-verification.json>).

## Implementation boundaries

The question provider discovers metadata without retaining all Sessions, excludes queued native question replies, retains one exact Session/request for a card, and never silently switches to another request. It uses the existing waterfall for open requests and the native continued-question RPC for continued ones. Failed shared attempts can retry; accepted replies remain locked until native state settles. Terminal views release their lease, draining admitted work independently of view abort. Closing/unmounting a view does not delegate the underlying request.

The native question fork and main bundle are the only updated archives. Layout, Workspace and the three accepted input-related fork archives are reused byte-for-byte from accepted releases. Source patch and eight changed declarations were refreshed.

## Validation policy

[Project instructions](<AGENTS.md>) now require direct main-agent execution unless an applicable loaded skill explicitly prescribes a subagent contract. Earlier free-form delegations were stopped and their unfinished changes reviewed by the main agent.

All four agreed changes were implemented before the consolidated build/regression pass. [Regression log](<sandbox/desktop-ui-polish-tests.log>): **355/355 PASS**. The first native build found missing declaration-only annotations; these were corrected and its selected build/declaration/module-edge gate passed. No extra functional sandbox probes are permitted: sandbox acceptance is startup-only, followed by cleanup. Functionality and appearance remain for the user to judge.

## Animation evidence and limits

Old [0.1.5 StateDot CSS](<sandbox/motion-baseline-015/package/lib/StateDot.module.css>) always plays its pixel animation; 0.2 StateDot honors reduced motion. This explains why old Web or other applications can animate while newer DSH does not, and does NOT prove DSH itself rewrites Windows settings.

The Windows runtime query returned client-area-animation=false even though the earlier preference change succeeded; current session metrics identify RDP. No definitive writer of that runtime override was identified. Instead the user explicitly chose a DSH-only global launch preference.

The installed executable contains Electron44.0.0 / Chromium152.0.7977.54 and the switch. [Exact Chromium tag](https://chromium.googlesource.com/chromium/src/%2B/152.0.7977.54/ui/gfx/switches.cc) declares `--force-prefers-no-reduced-motion`; [Electron44 release](https://releases.electronjs.org/release/v44.0.0) corroborates the Chromium version. This is configuration/source compatibility evidence, not an automated visual or animation test.

**First activation requires fully quitting Desktop and launching via an updated shortcut.** DSH's second-instance handler focuses the existing window and ignores new argv. [Normal app.relaunch()](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions) preserves CURRENT process arguments, so restarting an old process before that first correct launch may preserve the old argument list. Bare-executable/protocol launches and auto-updater/shortcut recreation may omit or replace shortcut-only arguments; do not promise the preference survives every future installation path.

## Immutable candidate

[Candidate inventory](<releases/0.2.12-desktop-ui-polish/candidates.json>)

- Main archive SHA256: `89b74666c1b44fec4b8699da65063003a200b7f44cbdc5e69cf0853296121bfe`.
- Main Client SHA256: `d6817af1c790a9ef8e30a1642043c47193fb4acc66bf9244da831a8310d518f2`.
- Questions archive SHA256: `2eaea26bb0c4a9f8e370ddc94e45e098a3cce96130dca3c371350298ecf39839`.
- Questions Client SHA256: `0e204ef1b7ab8c7d8cb9761aae365675ff8b1526b8d502ec86ea2e95a5cb064f`.
