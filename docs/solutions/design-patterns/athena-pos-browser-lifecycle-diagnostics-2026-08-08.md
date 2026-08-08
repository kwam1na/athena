---
title: Non-Perturbing POS Browser Lifecycle Diagnostics
date: 2026-08-08
category: design-patterns
module: POS browser telemetry
problem_type: design_pattern
component: tooling
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A browser-only failure cannot be reproduced outside one production terminal"
  - "Lifecycle ordering must be correlated with an existing unhandled rejection"
  - "Temporary diagnostics must reuse Athena's bounded offline telemetry rail"
tags: [pos, browser-lifecycle, telemetry, printing, correlation, diagnostics]
delivery_diff_fingerprint: 837de4189718832b45b4d63ee082e131723b6247d401c6f0c8746044c9569ff9
---

# Non-Perturbing POS Browser Lifecycle Diagnostics

## Problem

A production-only `Window.print()` rejection survived multiple speculative
lifecycle fixes. Existing POS telemetry proved the affected terminal, timing,
and sale correlation, but it could not distinguish the load branch, document
state, print return, or popup teardown ordering. Another behavioral change
without those facts would have been another guess.

## Solution

Add a temporary diagnostic at the browser lifecycle seams while leaving the
behavioral conditions and timers unchanged:

- Keep one module-level active attempt because popup printing is modal. Give it
  a random ID, invocation branch, `readyState`, return type, bounded event
  sequence, closed state, and completion reason.
- Gate detailed capture to the incident terminal. Treat the browser fingerprint
  only as a rollout selector; backend analysis must still constrain rows to the
  known store and terminal association.
- Emit at most one compact baseline through the existing
  `enqueuePosClientEvent` buffer. Stop baseline writes when 150 of 200 slots are
  occupied so temporary warnings cannot evict the next 50 errors.
- Retain the recent attempt for 60 seconds and enrich only the exact known
  rejection. If a second attempt begins during that window, report ambiguous
  correlation instead of guessing.
- Carry the causal close reason across `window.close()`. Record
  `beforeunload`/`unload`, then finalize with the pending `afterprint`, fallback,
  or throw reason. A short diagnostic-only grace timer covers browsers that
  queue unload or never dispatch it.

Do not inspect arbitrary reference return values for a `.then` property. A
getter or proxy trap can execute code and perturb the lifecycle under
observation. Record the primitive/null type safely and mark reference returns
as `not_inspected`.

## Why This Matters

Instrumentation is part of the race it observes. Immediate finalization after
`window.close()` can erase asynchronously queued unload events; letting unload
overwrite the causal reason makes every successful close look like an unload
failure. Similarly, structural thenable detection can invoke application or
browser bridge code. Preserving reason precedence and avoiding property access
produces evidence without changing the print contract.

Using the existing offline buffer also preserves Athena's current upload,
redaction, dedupe, and authorization boundaries. A new schema, query, retention
job, or receipt-level payload would add risk without improving this short
incident window.

## Prevention

- Characterize current browser branches before inserting checkpoints. Tests
  should prove which branch calls `print()` and when existing cleanup occurs.
- Model both synchronous and delayed lifecycle dispatch. A useful popup mock
  makes `close()` emit `beforeunload` and `unload`, then asserts event order and
  causal completion reason separately.
- Bound metadata at the producer: no more than 20 primitive keys and no event
  string longer than 300 characters.
- Pass a unique customer-like sentinel through the receipt input and assert it
  never reaches telemetry helper arguments.
- Refuse delayed correlation when candidates overlap. Incorrect attribution is
  worse than an explicit `ambiguous` marker.
- Keep the canary temporary. Once the evidence selects a fix, remove the
  fingerprint gate and detailed checkpoints, delete the temporary export and
  baseline rows, or explicitly justify retaining a coarse outcome signal.

## Examples

Unsafe teardown finalization:

```ts
printWindow.close();
finalizeAttempt("afterprint"); // queued unload can no longer be recorded
```

Correlation-safe teardown:

```ts
pendingCloseReason = "afterprint";
printWindow.close();
// unload appends its checkpoint and finalizes with pendingCloseReason;
// a short timer uses the same reason only if unload never arrives.
```

Unsafe return probing:

```ts
const isThenable = typeof returnValue.then === "function";
```

Non-perturbing classification:

```ts
const returnType = returnValue === null ? "null" : typeof returnValue;
const thenable =
  returnType === "object" || returnType === "function"
    ? "not_inspected"
    : "no";
```

## Related

- [POS Observability via Write-Riding Telemetry and Edge-Triggered Alerts](../architecture-patterns/athena-pos-observability-write-riding-telemetry-2026-07-19.md)
- [M Supplies print lifecycle instrumentation plan](../../plans/2026-08-08-001-fix-pos-print-lifecycle-instrumentation-plan.md)
- [Linear V26-1181](https://linear.app/v26-labs/issue/V26-1181/instrument-m-supplies-pos-print-lifecycle-before-fixing-browser)
