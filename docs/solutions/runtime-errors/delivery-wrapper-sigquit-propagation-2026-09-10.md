---
title: Delivery wrappers must preserve SIGQUIT cleanup
date: 2026-09-10
category: runtime-errors
module: delivery product launcher
problem_type: runtime_error
component: development_workflow
symptoms:
  - SIGQUIT stopped at the Athena TypeScript wrapper instead of reaching the installed launcher and its workers.
  - Terminal-group SIGQUIT could terminate the wrapper before descendant cleanup completed.
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [delivery-product, sigquit, process-signals, descendant-cleanup, installed-runtime]
delivery_diff_fingerprint: ea2500e9217ebc77f22061847ef305e399b568904391f307b7eddb4a424e1593
---

# Delivery wrappers must preserve SIGQUIT cleanup

## Problem

Athena runs the installed delivery product through `scripts/delivery-product.ts`. The wrapper forwarded SIGINT, SIGTERM, and SIGHUP, but it did not handle SIGQUIT. A direct or terminal-group SIGQUIT could therefore bypass the installed launcher's cooperative drain and bounded escalation path.

## Symptoms

- A worker never recorded SIGQUIT when the wrapper received it directly.
- A terminal-group SIGQUIT could end the wrapper without proving that the launcher and worker had exited.
- The wrapper did not return the conventional `128 + SIGQUIT` status of 131.

## What Didn't Work

- Testing only the TypeScript wrapper with a synthetic child would not prove the installed product boundary. The regression must launch `.agent-skills/current` so it covers the wrapper, installed launcher, and descendant worker together.
- Treating SIGKILL as another forwarded signal is impossible. SIGKILL cannot be caught; it is the launcher's bounded escalation mechanism for a worker that ignores the cooperative signal.
- Running the new SIGQUIT test against the previous 0.4.0 generation correctly stayed red because those installed bytes did not implement SIGQUIT drainage. Hand-editing that generation would have broken artifact provenance.

## Solution

Register a POSIX-only SIGQUIT handler beside the existing wrapper handlers. Preserve the first interruption status, forward SIGQUIT to the installed launcher, and continue awaiting `child.exited` before the wrapper returns 131.

The integration fixture records launcher and worker PIDs and the actual signal observed by the worker. Its matrix covers direct and terminal-group SIGQUIT for both cooperative workers and resistant workers. Cooperative workers exit on SIGQUIT; resistant workers force the installed launcher to use bounded SIGKILL escalation. After the wrapper exits, every case asserts that both descendants are absent or zombies. The fixture sends SIGQUIT only after both PID files exist, so it does not exercise arrival during launcher startup.

Keep the platform guard observable without pretending a macOS process is Windows. The wrapper's SIGQUIT listener lifecycle is a small helper that accepts the platform plus registration and removal callbacks. A simulated `win32` row proves neither callback runs, a POSIX row proves both run, and removing the guard kills that focused test. A separate ordinary-command row controls `process.platform` itself and observes the real process callbacks, so replacing the production platform binding with a POSIX constant also kills a focused test.

The repository installs the exact qualified product archive through `bun run agent-skills:install -- --archive ... --metadata ... --maintenance`. This keeps the generated generation, active pointer, exposures, runtime, and compiled policy bound to the producer artifact rather than local edits.

## Why This Works

Signal ownership stays layered. Athena translates the operator-facing signal into the installed launcher invocation and waits. The installed launcher owns group drainage, cooperative shutdown, escalation, and descendant cleanup. The tests observe the complete installed path, so they fail if either layer drops SIGQUIT or returns early.

The platform guard avoids registering unsupported POSIX signal behavior on Windows. Existing SIGINT, SIGTERM, and SIGHUP behavior remains covered by the same fixture. SIGKILL remains explicitly separate: the wrapper never claims to catch or forward it, and the launcher uses it only after the cooperative deadline expires.

## Prevention

- Extend wrapper signal matrices whenever the installed launcher's supported signal set changes.
- Pin both the listener helper and its production platform binding: an unconditional registration mutation and a `process.platform`-to-POSIX mutation must each fail.
- Exercise both direct delivery and terminal process-group delivery; shells and terminals can target different processes.
- Assert that no live descendants remain when wrapper completion is accepted instead of relying only on an exit code.
- Install and test exact qualified artifacts. Never repair a tracked generated generation by hand.
- Keep SIGKILL documented as uncatchable escalation, separate from cooperative signal propagation.

## Related Issues

- Linear V26-1912 — propagate SIGQUIT through Athena's installed delivery launcher.
- Linear V26-2016 — parent coordinated delivery for the consolidated product update.
