# Better Tasks 0.3.1 — self-contained Desktop distribution

Targets **DSH Desktop 0.2.0-rc.2**. Legacy DSH 0.1.5 users should retain a compatible older release; do not bypass runtime peer checks.

## Packaging

Install `@veewo/dsh-better-tasks@0.3.1` through Desktop Plugin Manager. The main npm archive includes all six reviewed native-named fork payloads using `bundledDependencies`. It does not require machine-local paths or URL subdependencies, and keeps default pnpm security protections enabled. The same six code archives and a sanitized SHA-256 manifest are provided on GitHub.

A package-local Loader group provides the resolution scope for those payloads. Native package names/ModuleLoader identities and input/commands/conversation option IDs are retained. Upstream licenses remain intact. The forks are not official upstream npm publications.

The 0.3.0 preparation tag is preserved as history, but **0.3.0 was not published to npm**: its URL-subdependency packaging failed the default pnpm install gate. No prior tag or verified archive is overwritten.

## Accepted functionality

Feature code is retained from the user-approved Desktop 0.2.18 baseline:

- Native Pin membership, separate task ordering and native New Session auto-Pin.
- Independent task input surfaces for messages/commands/skills and ordinary question cards.
- Host-backed display/disclosure preferences and independent single/double task columns.
- Card single-click navigation and double-click Final toggle, without clearing drafts.
- Current main-view task Final suppression, manual-choice priority and monotonic cold-start disclosure restoration.
- Windows caption and macOS frame-owned sidebar reopening while native layout owns width and collapse.

## Safety and delivery

New packaging must pass archive/file/dependency/identity/hash checks, installation under default pnpm policy, and the exact isolated Desktop cold-start gate. Cindy is disabled; home/Profile/Session/ledger/Electron storage are independent. Startup-only checks do not replace user functional/appearance acceptance. All owned sandbox processes/listeners must be removed before publication.

Stable npm/GitHub status is reported only after publication and registry/asset integrity verification. Public assets exclude private Profile backups, credentials, Session stores and raw runtime logs. Publishing does not reinstall or restart the user's existing Desktop 0.2.18. Restart after a separately requested install only when the user chooses to do so.
