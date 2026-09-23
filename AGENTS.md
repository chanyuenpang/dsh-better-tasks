# AGENTS.md

## Real-machine startup safety gate

Before any change is installed into or tested against the real `dsh web` profile, the exact candidate composition **must cold-start successfully in a sandbox**.

This startup gate is mandatory and takes priority over feature completeness:

1. Use the same candidate plugin rows, disabled native rows, local forks, and dependency graph intended for the real profile.
2. Give the sandbox its own `DSH_HOME`, profile, Session storage, and ledger. Never point a sandbox process at the real profile's storage.
3. Disable `dsh-cindy-host` in every sandbox composition. A sandbox must never affect mobile/P2P state.
4. Confirm that `dsh web` reaches a listening URL and that the browser shell activates without service-wait deadlocks or startup errors.
5. Core UI must remain activatable: root layout, sidebar, Session, Workspace, and conversation surfaces may not wait on an unfinished optional feature service.
6. Optional integrations must use optional service lookup and a safe native fallback until their provider has passed the sandbox startup gate. Do not add a hard `inject` before its provider is mounted in the same verified composition.
7. Do not edit the real composition, trigger live patch reload, or restart real DSH when sandbox startup fails—even if unit tests or feature tests pass.
8. Functional sandbox testing may follow startup validation, but functional incompleteness must never be allowed to block DSH startup.
9. Record the sandbox command/profile, listening URL, startup result, and browser error result before real installation.
10. Stop and verify removal of every sandbox listener/process before touching the real profile.

Sandbox start/stop/restart does not require user confirmation. A real-machine `dsh web` restart requires explicit user confirmation and the normal restart grace period. If a real startup fails, restore the last known-startable composition before attempting feature repair.
