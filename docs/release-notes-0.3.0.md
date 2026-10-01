# Better Tasks 0.3.0 — DSH Desktop release

## Compatibility

- Targets **DSH Desktop 0.2.0-rc.2**. This is a new Desktop line; legacy DSH 0.1.5 Web users should retain their existing compatible version (npm 0.2.4).
- Install `@veewo/dsh-better-tasks@0.3.0` using Desktop Plugin Manager. The removable bundle resolves six audited native-named fork dependencies from fixed public GitHub URLs; no developer checkout or machine-local dependency paths are needed.
- The fork packages are compatibility assets, not official upstream npm publications. Upstream names/ModuleLoader IDs and licenses are retained.

## Included improvements

- Native Pin membership and independent task-card ordering, with auto-Pin for native New Session flows.
- Native task input surfaces for messages/commands/skills and ordinary question cards sharing native draft/settlement ownership.
- Host-backed display settings, project/task title emphasis, detail/question text size, task columns and native/tasks sidebar selection.
- Card single-click still opens immediately; double-click toggles Final. Closing is immediate and cancels pending preview/body-click work without discarding input drafts.
- Current main-view tasks do not automatically expand Final for a new idle cycle. Manual choice wins; navigation does not retroactively open the suppressed cycle.
- Saved Final disclosure choices survive cold catalog timestamp fallback and later hydration; consumed activity watermarks never regress.
- Desktop sidebar reopen controls remain available at zero-width collapse: Windows caption controls and the macOS frame-owned leading seat. Native layout remains the width/state owner.

## Installation and rollback

Restart Desktop if Plugin Manager says restart is required; publishing/installing does not itself restart the app. Do not bypass runtime peer checks or simultaneously enable the shipped sidebar root. Removing the bundle restores its native UI rows and does not delete Session, Pin, Goal/Todo, appearance or settings data.

The main package, six fork archives and SHA-256 manifest are attached to this release. The forks use a separately revisioned dependency-library tag so main patch releases can reuse exact accepted bytes. Existing local Desktop 0.2.18 installations were not reinstalled or restarted by this public-release task.

## Validation policy

Functionality is frozen from the user-approved Desktop 0.2.18 candidate. Public packaging receives its own file-list/dependency/hash checks and exact public-URL package-manager Desktop cold-start gate in isolated storage with Cindy disabled, followed by complete process/listener cleanup. Sandbox validation is startup-only; no extra functional or visual sandbox QA is substituted for user acceptance.

The stable release is promoted only after those checks and npm registry integrity/latest verification have succeeded. Public assets never include real Profile backups, Session stores, credentials or raw runtime/token logs.
