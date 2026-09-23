# Roll back the Better Tasks sidebar

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

The latest backup restores Better Tasks with the local Workspace fork but without the layout fork; the Workspace backup restores the earlier sidebar-only integration.

Rollback does not delete Session, Workspace, Goal, Todo, cost-meter, project-appearance, or Host pin-queue data. The browser-only keys `dsh-better-tasks.projection-expansion.v1`, `dsh-better-tasks.final-auto-open-cycle.v1`, `dsh-better-tasks.final-message-cache.v1`, and `dsh-better-tasks.layout.sidebar-width.v1` may remain safely; shipped packages do not consume them.
