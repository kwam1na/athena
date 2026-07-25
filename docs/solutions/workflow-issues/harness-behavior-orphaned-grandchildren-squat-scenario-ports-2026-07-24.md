---
title: Orphaned Harness Grandchildren Squat Scenario Ports and Make Behavior Runs Assert Against a Foreign Server
date: 2026-07-24
category: workflow-issues
module: scripts
problem_type: workflow_issue
component: harness-behavior
resolution_type: workflow_improvement
severity: high
applies_when:
  - A harness:behavior scenario times out under pr:athena but passes when run standalone
  - A scenario readiness check completes in tens of milliseconds instead of seconds
  - lsof shows a vite or fixture server on a scenario port with PPID 1
tags: [harness-behavior, process-groups, detached, port-isolation, test-determinism, orphaned-processes]
delivery_diff_fingerprint: 615f240bea97887757c4fea636eac844f1a40f2f4a516a2cff4d7c4b4275a327
---

# Orphaned Harness Grandchildren Squat Scenario Ports and Make Behavior Runs Assert Against a Foreign Server

## Problem

`storefront-checkout-verification-recovery` failed reproducibly inside
`bun run pr:athena` with a 40s Playwright timeout waiting for
`text=Get excited, Ada!`, while passing in ~1.3s when run standalone. The
storefront diff under review touched exactly that flow, so the failure read as a
regression in the change rather than a harness defect.

Two harness bugs combined to produce it.

`spawnCommand` in `scripts/harness-behavior.ts` ran each scenario process as
`sh -lc "<command>"` and cleanup signalled only that shell. Scenario commands
fork long-lived grandchildren — `bun run --filter '@athena/storefront-webapp' dev`
execs vite as a separate process — so `SIGTERM` to the shell left vite alive,
reparented to init (`PPID 1`), still listening on port 4314.

The HTTP readiness check only probed the URL. A survivor from an earlier run
satisfied it instantly, so the next scenario never booted its own server and
instead drove a server wired to a *different* fixture API instance. Scenarios
that do not depend on specific fixture state still passed; the one that needs
verification-recovery fixture data could not render, and failed as an opaque
selector timeout.

The tell is in the phase durations: readiness took ~25ms when reusing a
survivor versus ~1160ms for a genuine boot.

## Solution

Spawn each scenario process into its own process group and signal the whole
group on cleanup:

```ts
const nodeSubprocess = spawnChildProcess(shellPath, ["-lc", command], {
  cwd,
  env: mergedEnv,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
```

`killProcessTree` then signals the group via a negative pid, treating `ESRCH`
as already-gone and falling back to a direct child kill. This required dropping
the `Bun.spawn` branch: `Bun.spawn` cannot place a child in its own process
group, which is the entire mechanism the fix depends on. The existing stream
reader already handles both web and node stream shapes, so unifying on
`node:child_process` is behavior-preserving.

Second, `assertScenarioPortsAvailable` runs at the start of the boot phase. It
collects local ports from the scenario's HTTP readiness URLs and fails if any is
still listening, naming the port and the check that owns it.

Third — and this is the fix that actually releases the ports — `stopProcess`
now sweeps the process group with `SIGKILL` unconditionally after the wrapper
exits:

```ts
if (Number.isNaN(exitCode)) {
  processRef.kill("SIGKILL");
  await processRef.exited;
}

processRef.kill("SIGKILL"); // sweep survivors in the group
```

The pre-existing escalation only fired when the *wrapper* failed to exit in
time. But the wrapper shell exits the moment it is signalled, so that branch
was never taken and the grandchildren were never escalated against — they
lingered for as long as they felt like. Waiting on the wrapper's exit says
nothing about who still owns the port.

Both port checks also wait rather than sampling once, because sockets do not
close synchronously. Two attempts got these windows wrong before this landed:

- Failing instantly on any listening socket turned normal teardown latency into
  a red build.
- Then waiting 15s in cleanup breached the scenarios' own 15s cleanup latency
  threshold — a wait as long as the ceiling can only ever break it.

The windows are now asymmetric and sized against their phase budgets: 3s in
cleanup (slack for scheduling, not a budget to spend — with the group sweep in
place, observed cleanup is 4–110ms) and 10s in the boot guard, which has no
comparable ceiling and is distinguishing draining from foreign ownership. Both
are overridable via `HARNESS_BEHAVIOR_PORT_WAIT_MS`.

Fourth: process-group membership turned out not to be a reliable handle at all.
On CI the group sweep still left 4314 held — cleanup burned its full release
wait and the next scenario's boot guard then waited its full window and still
found the port occupied. `bun run --filter ... dev` can start the real server in
its own session, outside the group the harness created, so no amount of
signalling that group reaches it.

Cleanup therefore falls back to reclaiming the port directly: look up whatever
still listens (`lsof`, then `ss`, then `fuser` — no single one exists on every
image) and kill it. This is only sound because of the boot precondition. The
scenario refuses to start unless its ports are free, so any listener at cleanup
was started by this scenario. Without that invariant this would be an
indiscriminate "kill whatever is on port 4314", which would happily take out a
developer's own dev server.

## Why This Works

The two fixes are complementary and neither alone is sufficient. Process-group
cleanup removes the usual source of survivors, but cannot help when an
unrelated process already owns the port. The port precondition converts that
remaining case from a silent false result into an immediate, named failure —
a scenario can no longer assert against a server it did not boot.

Failing closed matters more than convenience here: reusing a listening server
is never correct for these scenarios, because fixture state is established by
the process the harness boots.

## Prevention

- Any harness process spawned through a shell wrapper must be spawned
  `detached` and torn down by process group; signalling the wrapper alone is
  not cleanup when the real server is a grandchild.
- Treat a readiness check that returns in tens of milliseconds as suspicious —
  it usually means a server was reused rather than booted.
- A port precondition must distinguish "still draining" from "owned by someone
  else". Killing a process group does not free its sockets synchronously, so a
  guard that samples once turns normal teardown latency into a red build.
- Escalate to `SIGKILL` on the group unconditionally, not only when the wrapper
  overruns its stop timeout. A shell exits immediately when signalled, so an
  escalation gated on the wrapper's exit never protects against the
  grandchildren that actually hold the resources.
- Size any added wait against the phase's own latency threshold. A wait equal to
  the ceiling converts a slow teardown into a guaranteed breach; fix the
  underlying leak and keep the wait as slack.
- Do not assume a spawned command's real server is in the process group you
  created. Package-manager wrappers may start it in a new session. Own the
  resource (the port) rather than the process handle, and establish an
  invariant that makes reclaiming it safe.
- A regression test that exercises escape-from-process-group must create the
  escape portably. A first version used `setsid`, which does not exist on
  macOS, so the test passed there without the fix in place and proved nothing.
  Always confirm a new test fails without its fix on the platform you run it.
- Do not diagnose an environment-dependent harness failure from a standalone
  rerun alone. A standalone pass can be produced by the very survivor that
  causes the gate failure, so the rerun confirms nothing until the port is
  verified free first.

## Examples

Before, a leaked server was invisible and readiness passed against it:

```
[readiness] check "storefront-runtime-app-shell" -> http://127.0.0.1:4314/ (expect 200)
  ... readiness durationMs: 25      # reused a survivor
[browser] Timeout 40000ms exceeded waiting for text=Get excited, Ada!
```

After, the same situation fails in milliseconds with the cause named:

```
[boot] port precondition failed: 127.0.0.1:4314 (readiness check "storefront-runtime-app-shell")
Scenario ports already in use before boot: 127.0.0.1:4314 ...
```

Both behaviors are covered by regression tests in
`scripts/harness-behavior.test.ts` under `scenario process isolation`. The
orphan test asserts the port is released after the scenario, and fails when
`detached` is set back to `false`.

## Related

- [A Dev .env.local Leaks Into Vitest and Breaks Env-Gated Tests](./athena-env-local-leaks-into-vitest-pin-with-env-test-2026-07-23.md)
- [Anonymous Callers Need An Explicit Public Actor In Operation Admission](../architecture-patterns/athena-public-operation-admission-2026-07-24.md)
