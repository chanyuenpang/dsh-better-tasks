# Desktop input UI/UX restoration

The user accepted 0.2.9 functionality but rejected the changed presentation. The 0.2.8 task input is the reference, not the main conversation composer. No computed-style, geometry or screenshot comparisons were used.

## Restored contract

- One left-hand plus button opens the combined skill/command picker; the right-hand round send button uses the original arrow path. The plus uses the exact original local 24-viewBox glyph, not the removed `IconPlusOutline16` SDK export.
- Original source values: 18px input border radius, 32–120px growing editor, 12px text/18px line-height, 27px plus, 28px send, 500ms top tooltips, 29px search input and 180px candidate list.
- Ordering: editor → search/picker → action row. Error feedback sits below the rounded input.
- Exact-empty placeholder hides while the editor is focused. Accessible name remains present; whitespace-only input still uses localized Continue.
- Separate search never changes draft, selection or revision. Combined launcher captures detect-coordinate selection plus CAS; source changes/refetch retain that capture and query.
- Skill insertion replaces only the captured selection and restores the resulting caret. A non-whitespace prefix gets the original separating space; typed slash replacement remains unchanged. Native range edits preserve chips/undo rather than replacing the whole draft.
- Search Enter selects only: pending/empty/failed lists cannot send a prompt. Empty forward Tab is not trapped. Escape/Shift-Tab return to editor; outside dismissal, folding and popup handoff do not steal focus.
- Parameter-popup search and combined search protect composition/isComposing/keyCode229, composition-end Enter and held Enter. Normal repeated arrows remain available.
- Skill/claim selection restores editor focus; parameter commands give focus to their popup. The outer card excludes option/listbox/popup areas from blank-space focusing and keeps drag guards.
- Failed catalog sources are distinguishable from no matches; healthy sources remain selectable. New requests clear the previous failure marker without rebasing the captured draft revision.
- Old notice sequences are dismissed by user edits, successful insertion or an explicit new send. Search edits and programmatic failure restoration do not suppress newer asynchronous errors.
- Native claim hints are shown only while arguments are empty, and hidden during IME composition.

## Implementation and checks

Business send/Goal/retention logic from 0.2.9 is retained. All changes are in presentation/interaction glue, the combined native trigger launcher and popup key guards. Original layout/workspace/questions archives are unchanged.

- Full suite: **289/289 passed** in [regression log](<sandbox/desktop-input-style-tests.log>).
- Native fork builds, changed declarations and strict official module-edge comparisons passed.
- Source patches regenerated for the three input forks.
- Focused actual-TSX handler tests cover the small UX contracts; editor/source tests cover selection CAS, source routing, failure isolation and lifecycle.
- Candidate: 0.2.10 in [inventory](<releases/0.2.10-desktop-input-style/candidates.json>).
- [Exact Electron cold start](<sandbox/.desktop-input-style-0210/enabled.acceptance.json>): PASS; core entries active, zero renderer errors, all seven served candidate hashes match.
- [Focused combined-picker check](<sandbox/.desktop-input-style-0210/input-surface.acceptance.json>): PASS; separate search/empty Enter do not send or alter the draft; selecting a skill over `待替换` produced `帮我 /cindy-skill-creator 后文`; focus returned to the editor, then transferred correctly to a command parameter popup; the other surface/main draft remained unchanged and references returned to zero.
- Ordinary submission used an explicit sandbox-only sink after native adjudication/serialization, not real Host/model traffic. No real model requests or visual measurements were made.
- Installed **0.2.10** through Plugin Manager; result **restart-required**. [Installed verification](<releases/0.2.10-desktop-input-style/installed-verification.json>) passed all seven archive/client hashes and lock integrities, with no user-setting row changes or unrelated dependency/bundle changes relative to the immediate preinstall backup.
- Post-install graph verification detected a concurrent, unrelated Cindy update from 0.1.16 to 0.1.17 since the original sandbox snapshot. It was preserved, not reverted. The unchanged candidate was cold-started again against the current graph, with Cindy Host still disabled for sandbox safety: [current-graph startup](<sandbox/.desktop-input-style-0210-current/enabled.acceptance.json>).
- [Current dependency graph](<releases/0.2.10-desktop-input-style/dependency-graph-verification.json>) passed: all 211 resolutions/snapshots, settings and importers match after local-tarball path normalization. Graph SHA256: `b1ec4cba1ba4769f48d0b370288255e4d1a0cb75861020a6f0d30467a819650e`.
- Main archive SHA256: `7e8bd0bb31abc9d291f94b6f63a547be2f0cc9d094f485eaeaacb79a04089331`; main Client SHA256: `a604c259030b6b7db20c8f0ef15de3b416bd8ad10f467e01b9c537b0bf9a4d4f`.
- Both isolated runs were closed and verified without remaining owned processes or listeners: [initial cleanup](<sandbox/.desktop-input-style-0210/cleanup.acceptance.json>), [current-graph cleanup](<sandbox/.desktop-input-style-0210-current/cleanup.acceptance.json>).
- The agent did not restart the real Desktop. The user subsequently confirmed: “已经重启了，外观和交互都没有问题”. Version 0.2.10 is accepted for both appearance and interaction; the historical installation-time `restart-required` result is no longer a pending acceptance item.
- Future installations should recheck unrelated profile dependencies immediately before installation, not only after it, to catch concurrent package changes earlier.
