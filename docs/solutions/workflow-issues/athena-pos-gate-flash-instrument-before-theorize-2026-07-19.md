---
title: Athena POS Gate Flashes — Instrument the Live State Before Theorizing
date: 2026-07-19
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - A POS register or drawer gate briefly flickers to the wrong UI state before settling
  - A render loop or transient state bug looks explainable from reading the code alone
tags: [pos, register-gate, debugging, instrumentation, transitional-state]
delivery_diff_fingerprint: fcaf5e5dfd76e8298d1437d318320257df9e34d9b02dbb0b117c15b7d5b3ec2f
---

# Athena POS Gate Flashes — Instrument the Live State Before Theorizing

## Problem

Athena's POS register view renders a chain of exclusive UI gates (drawer-not-saved,
register-closed-locally, onboarding, drawer-open) chosen by a ternary chain over
several view-model fields. When the underlying state machine passes through a
transitional value on its way from one resting state to the next, a gate whose
render condition doesn't distinguish "resting" from "transitional" briefly shows —
a visible flash a cashier or manager notices, even though the final settled state
is correct.

## Symptoms

- The "drawer not saved" gate flashes for a frame or two after opening a
  replacement drawer, even though the drawer opens successfully.
- The "register closed locally" gate flashes during a closeout submit, before the
  "open a replacement drawer" gate renders — even though the closeout is correct.
- An Expense register view enters an infinite render loop with no obviously wrong
  code on first read.
- In all three cases, the first root-cause theory formed by reading the code was
  wrong.

## What Didn't Work

- Reading `hasBlockingAuthorityPersistenceFailure`'s reason-code list and guessing
  which reason was transitional (`candidate_invalid`) — the real transient reason
  was a different one (`mapping_invalidated`) that only showed up when the actual
  gate state was captured during a real replacement-drawer open.
- Hypothesizing that a derived boolean (`activeCloseoutCanOpenReplacementDrawer`)
  flipped late and caused the register-closed flash — direct instrumentation
  showed that value was `false` for the entire flash window, disproving the
  theory outright.
- Trusting a subagent's traced explanation of the Expense render loop over direct
  evidence — the trace was plausible but pointed at the wrong layer; the actual
  cause (a Proxy facade returning a new function identity on every access) only
  surfaced once the render was instrumented directly in the browser.

## Solution

Console-log the exact view-model fields a gate's render condition reads, across
the real failing interaction, before writing a fix:

```tsx
if (import.meta.env.DEV) {
  console.log("[gate-debug]", {
    showGate: someGateCondition,
    syncStatus: localCloseoutSyncStatus?.status,
    drawerGate: viewModel.drawerGate?.mode ?? null,
  });
}
```

Reproduce the interaction in a real browser session (sign in, drive the actual
closeout/drawer-open/expense-add flow), capture the sequence of values, and only
then identify which values are transitional versus resting. For the register-closed
flash, this showed `drawerGate` genuinely drops to `null` for about 21ms during the
hand-off between two drawer-gate views — a real gap, not a symptom of the wrong
derivation. The fix made the gate's render condition depend on the co-occurring
signal (`!viewModel.drawerGate`) rather than only the value that seemed relevant
from reading the code, and added a short settle delay to bridge the residual gap.

## Why This Matters

Transitional-state bugs are, by definition, invisible to static code reading: the
code correctly transitions through the offending value, and nothing in the source
marks that value as "don't render a gate for this." Only capturing the live
sequence of values during the actual interaction reveals which value is the
transitional one. All three bugs on this branch had a plausible, code-reading-based
first theory that was wrong; all three were correctly diagnosed only after direct
instrumentation of the real runtime state.

## Prevention

- When a gate/render-loop bug is reported as "flashes briefly" or "loops
  intermittently," instrument the actual state before proposing a fix — don't
  treat a plausible trace (yours or a subagent's) as verified until it's been
  checked against live captured state.
- Prefer a temporary `console.log` gated by `import.meta.env.DEV` (or direct
  browser instrumentation) over reasoning from the ternary chain alone; remove the
  temporary log once the fix is verified.
- After a fix, re-run the exact interaction and confirm the previously-flashing
  state never renders across the transition, not just that the final settled
  state looks right in a screenshot.

## Examples

The register-closed-locally gate fix in `POSRegisterView.tsx` added
`!viewModel.drawerGate` to its render condition and a 200ms settle timer
(`isLocalClosedRestSettled`), verified by capturing `{candidate, settled, sync,
gate}` across a full closeout-to-replacement-drawer cycle and confirming the card
never rendered mid-transition. The drawer-not-saved fix in `registerUiState.ts`'s
`hasBlockingAuthorityPersistenceFailure` was corrected the same way, after the
first attempt suppressed the wrong reason code.

## Related

- [Athena Cross-Layer Delivery Needs Bounded Reads and Contract Proof](athena-cross-layer-delivery-contracts-2026-07-18.md)
