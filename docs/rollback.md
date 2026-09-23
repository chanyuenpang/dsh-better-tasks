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
- Before switching from development paths to packaged plugins: `${DSH_HOME:-$HOME/.dsh}\profiles\web\cordis.patch.yml.before-dbt-package-0.2.0`

The latest backup restores the four Better Tasks rows with their development `file:///G:/Projects/...` paths. Prefer reinstalling a known release from `${DSH_HOME:-$HOME/.dsh}\plugin-releases\dsh-better-tasks\` and keeping package-name composition; use the development-path backup only for diagnosis.

Rollback does not delete Session, Workspace, Goal, Todo, cost-meter, project-appearance, Host pin-queue data, or the `better-tasks-ui` Host settings namespace. The browser-only keys `dsh-better-tasks.projection-expansion.v1`, `dsh-better-tasks.projection-expansion.v2`, `dsh-better-tasks.goal-auto-open-cycle.v1`, `dsh-better-tasks.final-auto-open-cycle.v1`, `dsh-better-tasks.final-message-cache.v1`, and `dsh-better-tasks.layout.sidebar-width.v1` may remain safely; shipped packages do not consume them.
