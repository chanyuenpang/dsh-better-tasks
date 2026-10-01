# Roll back the Better Tasks sidebar

## Current Desktop 0.3 bundle

Use Desktop Plugin Manager to disable/remove `@veewo/dsh-better-tasks`, or reinstall a previously verified compatible main archive with its exact fork dependency graph. This bundle owns one removable patch layer: it disables native `ui-layout`, `ui-sidebar`, `ui-workspace` and `ui-user-questions`, and inserts the matching `*-dbt` rows plus `better-tasks-ui`. Removing the layer restores those native rows; do not copy its disables into the user's patch file.

Preserve the accepted previous package manifest/lock and its immutable archives before an upgrade. Do not overwrite concurrent model/view/settings changes with an old backup. Re-run package-manager installation for a changed profile path rather than copying an invalid hoisted virtual-store location. Real Desktop restart remains a user decision; no automatic restart or live package-identity migration.

Never delete native Session/Workspace/Pin membership, the Better Tasks order domains, Goal/Todo, project appearance, ledger, `better-tasks-ui` settings or client disclosure/cycle keys to make a rollback appear successful. Legacy Pin order remains readable for rollback, while current native membership has one owner.

## Historical 0.1.5 Web composition (not the 0.3 install recipe)

The real profile patch is `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml`.

## Restore all shipped UI packages

1. Remove the block between `# BEGIN dsh-better-tasks exact-fork sidebar replacement` and `# END dsh-better-tasks exact-fork sidebar replacement`.
2. Restart `dsh web`.
3. Refresh the Web page with the new token URL.

Removing that block re-enables the shipped `ui-layout`, `ui-sidebar`, `ui-workspace`, and `ui-user-questions` rows and removes exactly these local rows:

- `ui-layout-dbt`
- `better-tasks-sidebar`
- `ui-workspace-dbt`
- `ui-user-questions-dbt`

## Backups

- Before the original sidebar replacement: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-better-tasks`
- Before the Workspace fork: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-ui-workspace-fork`
- Before the layout fork: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-ui-layout-fork`
- Before the final three-fork install: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-better-tasks-final`
- Before switching from development paths to packaged plugins: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-dbt-package-0.2.0`
- Before the abandoned live scoped-identity migration: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-dbt-0.2.1`
- Before the Workspace-only pinned-title rollout: `${DSH_HOME:-$HOME/.dsh}\profiles\web\package.json.before-dbt-pin-emoji` and `pnpm-lock.yaml.before-dbt-pin-emoji`

The real `0.2.1` pinned-title rollout intentionally keeps the stable unscoped `dsh-better-tasks@0.2.0` main package and composition row, and updates only the immutable Workspace fork from the `0.2.1` release directory. Roll it back by installing the Workspace tgz from the `0.2.0` release directory, then perform an approved clean restart. Do not live-switch the main Client package identity between `dsh-better-tasks` and `@veewo/dsh-better-tasks`: the old locale fiber can overlap the new package during live reload.

Rollback does not delete Session, Workspace, Goal, Todo, cost-meter, project-appearance, Host pin-queue data, or the `better-tasks-ui` Host settings namespace. The browser-only keys `dsh-better-tasks.projection-expansion.v1`, `dsh-better-tasks.projection-expansion.v2`, `dsh-better-tasks.goal-auto-open-cycle.v1`, `dsh-better-tasks.final-auto-open-cycle.v1`, `dsh-better-tasks.final-message-cache.v1`, and `dsh-better-tasks.layout.sidebar-width.v1` may remain safely; shipped packages do not consume them.

## Roll back a scoped main-package identity switch

Do **not** restore an unscoped patch while a scoped Better Tasks Client is still running (or vice versa). Preserve the complete previous `profiles/web` directory and its immutable unscoped main tgz as the rollback source; Session, Workspace, Goal, Pin, settings and ledger storage stay outside that Profile and must not be removed.

After an explicitly authorized stop, and only once the old Host and its target child processes have exited, restore the previous Profile directory as a unit (package manifest, lock, workspace patch configuration, client patch and installed dependencies). Moving a pnpm hoisted Profile changes its absolute `node_modules/.modules.yaml` virtual-store path: set `$env:CI = "true"` and the correct `$env:DSH_HOME`, then run `pnpm install --offline --frozen-lockfile` with the restored `profiles/web` as the working directory before starting it. Verify the original `dsh.profile.bundles` order, the unscoped main and three unchanged forks, and the absence of the scoped main. Using `dsh plugin --profile web install` here can reorder the bundle list. If this fails, leave DSH stopped and report the exact recovery status; do not trigger a live identity reload or an unapproved second restart.
