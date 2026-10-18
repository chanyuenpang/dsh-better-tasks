# AGENTS.md

## Single-agent execution

- The main agent must personally advance this project's tasks. Do not independently delegate implementation, research, review or validation to subagents or teammates.
- The only exception is when an applicable, loaded skill explicitly specifies subagent dispatch. Dispatch strictly within that skill's contract: its prescribed scope, timing, roles, inputs, outputs and limits. Generic tool availability, efficiency, parallelism or an optional suggestion is not authorization.
- Do not select or create a skill merely to bypass this restriction, and do not expand a skill-authorized delegation into additional ad hoc work.
- Do not use multi-agent orchestration as a substitute for direct execution. If delegation outside an applicable skill contract is already running, stop it before taking over its files.

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
8. Sandbox validation is startup-only. Do not test specific feature behavior in the sandbox; functional incompleteness must never be allowed to block DSH startup.
9. Record the sandbox command/profile, listening URL, startup result, and browser error result before real installation.
10. Stop and verify removal of every sandbox listener/process before touching the real profile.

Sandbox start/stop/restart does not require user confirmation. A real-machine `dsh web` restart requires explicit user confirmation and the normal restart grace period. If a real startup fails, restore the last known-startable composition before attempting feature repair.

## Batch completion and proportional validation

- Finish **all agreed changes in the current round before validation**. Then perform one consolidated build/regression/package-validation pass and stage one exact candidate. Do not validate, rebuild, install or release each small feature or styling change separately.
- The sandbox is **only for startup safety**: confirm the listening endpoint, successful core browser-shell activation and absence of startup errors, then stop and clean up. Do not add feature-specific sandbox probes for messages, skills, commands, Pin, question options, font sizes, animation behavior or other interactions.
- **The user performs functional and appearance acceptance.** After the startup gate and cleanup, install the verified candidate and hand it off. Do not substitute additional sandbox interaction tests for the user's acceptance.
- Keep necessary unit/contract and package-consistency checks in the consolidated validation pass. Unless the user explicitly asks for automated visual verification, **do not write or run code to measure computed CSS, geometry, pixels, screenshots, or other visual details**.
- If a build, regression check or startup gate fails, investigate and fix that failure, then rerun only the necessary checks. This exception does not authorize extra functional sandbox QA or successive releases for unrequested visual tuning.
- Do not automatically restart the real Desktop; keep the existing explicit-user-authorization boundary.
