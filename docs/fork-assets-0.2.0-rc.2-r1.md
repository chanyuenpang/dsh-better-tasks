# Better Tasks Desktop compatibility forks — DSH 0.2.0-rc.2, revision 1

These six archives are the reviewed compatibility forks used by Better Tasks 0.3.0, **not official npm releases** of `@deepseek-ai/*`. Their original names and Client ModuleLoader identities are retained for runtime compatibility. They are release assets only; no packages are published to the upstream npm scope.

The code and archive bytes are reused from the user-approved Desktop composition. `forks-manifest.json` lists the SHA-256 archive/client digests, sizes and permanent download URLs. Upstream licenses are retained inside every archive; source patches and baseline provenance are in this repository.

This is a dependency asset library, not a standalone DSH plugin. Install `@veewo/dsh-better-tasks@0.3.0` through DSH Plugin Manager after the main release passes validation. The main package resolves these immutable URLs automatically.

The library has its own tag so patch releases of the main plugin can reuse the exact same verified fork bytes. During main-release validation this library is marked prerelease and is not promoted as the repository's latest plugin release. Archives must never be replaced under the same filename/tag; a changed fork requires a new library revision and a new main package version.
