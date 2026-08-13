---
title: Actionable POS Storage Health Diagnostics
date: 2026-08-13
category: design-patterns
module: POS terminal runtime health
problem_type: design_pattern
component: tooling
resolution_type: code_fix
severity: medium
applies_when:
  - "A browser capability or storage signal is reported as terminal health"
  - "Operators need to distinguish actionable pressure from informational diagnostics"
tags: [pos, storage-health, diagnostics, operator-ux, convex]
delivery_diff_fingerprint: f73879e5f7b46bce119183a3b2ca92e14d8b7fe893e3162e868fdae9b9f3812a
---

# Actionable POS Storage Health Diagnostics

## Problem

Browser storage telemetry mixed actionable capacity pressure with environmental
capabilities. A browser declining persistent storage could therefore label a
terminal as needing attention even when its local event ledger was small and
storage usage was healthy. The UI also lacked enough evidence to explain why a
warning appeared.

## Solution

Separate warning classification from supporting diagnostics:

- Treat quota pressure and bounded local-ledger pressure as warning causes.
- Keep persistence state as diagnostic context because browser persistence is
  not an operator-controlled setting.
- Publish the bounded local event count through the existing redacted runtime
  check-in contract. Do not upload event payloads.
- Put the primary cause first in an accessible warning tooltip, followed by
  relevant event-count, usage, ledger, and persistence facts.
- Reuse the shared relative timestamp component wherever the terminal detail
  presents report times.

The classification should express actionability directly:

```ts
const storageNeedsAttention = quotaPressure || ledgerPressure;
```

Persistence still travels with the runtime health material so support can use
it during diagnosis, but it does not independently set the warning state.

## Why This Matters

Health labels are operational promises. If a warning names a condition the
operator cannot change, it creates alert fatigue and obscures the conditions
that do require intervention. Separating classification from evidence keeps the
list scannable while preserving detailed support context on demand.

The local event count is safe and useful only as a bounded aggregate. Carrying
the count through the terminal check-in and Convex projection explains ledger
pressure without widening the telemetry boundary to event contents.

## Prevention

- Test each diagnostic dimension independently, especially capability-only
  states that should remain healthy.
- Keep warning predicates tied to an operator or support action, not merely to
  an unavailable browser capability.
- Extend the existing redacted runtime-health contract with aggregates rather
  than creating a second reporting path or uploading local records.
- Verify tooltip content through both pointer-independent semantics and focused
  component tests.

## Examples

Persistence denial alone:

```ts
{
  persistence: "denied",
  quotaPressure: false,
  ledgerPressure: false,
  storageNeedsAttention: false,
}
```

Ledger pressure with supporting evidence:

```ts
{
  ledgerEventCount: 8_000,
  ledgerPressure: true,
  storageNeedsAttention: true,
}
```

## Related

- [Linear V26-1211](https://linear.app/v26-labs/issue/V26-1211/clarify-pos-terminal-storage-health-evidence)
- [Linear V26-1008](https://linear.app/v26-labs/issue/V26-1008/add-pos-storage-durability-and-redacted-health-evidence)
- [Non-Perturbing POS Browser Lifecycle Diagnostics](./athena-pos-browser-lifecycle-diagnostics-2026-08-08.md)
