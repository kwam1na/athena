---
title: Manager-gated operational surfaces and closeout policy controls
date: 2026-07-07
category: docs/solutions/architecture-patterns
module: Athena POS and operations access
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: medium
applies_when:
  - "A POS-facing route exposes cash, product, operations, or trace evidence that cashiers should not see by default"
  - "Manager elevation should unlock the same page-level operational affordances as manager access"
  - "A store policy control affects backend register closeout approval behavior"
tags: [athena, pos, access-control, manager-elevation, closeout]
---

# Manager-gated operational surfaces and closeout policy controls

## Problem
POS operators need a fast sales surface, but related operational areas expose sensitive cash, trace, product, and store-day evidence. The same project also stores register closeout approval policy in store config, so the UI control for that policy must write the exact backend field the closeout gate already reads.

## Solution
Treat manager-visible POS-adjacent surfaces as one access posture instead of scattering one-off checks. Route and navigation guards should use the shared manager/full-admin capability, while backend policy writes that change store configuration should still require full-admin access.

For register closeout approvals, the backend gate reads:

```ts
operations.cashControls.varianceApprovalThreshold
```

Expose the POS settings control through a narrow full-admin query/mutation that:

- Reads the active store's cash-controls config with the same helper used by closeout review.
- Accepts display currency from the UI, converts it to minor units client-side, and stores the minor-unit threshold.
- Preserves existing `operations.cashControls` flags such as signoff for shortages or overages.
- Rejects invalid negative or non-finite thresholds at the API boundary.

Keep the threshold copy precise: variances greater than the threshold require manager approval. The comparison is strict, so a threshold of `5000` minor units means a GHS 50 variance is still allowed unless another signoff flag requires review.

## Why This Matters
Operational access bugs usually appear as small UI leaks: a metric card, trace button, cash position value, or sidebar route remains visible to a cashier after the main route was gated. Centralizing the capability makes the page, nav, and component decisions agree.

Policy controls need a stricter boundary than read-only manager elevation. A manager-elevated cashier can view and act on operational work, but changing store-level policy should stay full-admin-only and should be covered by backend authorization, not only hidden UI.

## Prevention
- Gate cash controls, operations, products, and POS diagnostics with a shared manager/full-admin capability instead of local route-specific booleans.
- Keep sensitive component-level readouts behind the same capability even when the parent page remains usable for cashier workflows.
- Put store-policy writes behind full-admin Convex mutations, even when the setting appears on a manager-facing page.
- Preserve backend policy units in tests: UI fields may show major currency units, but Convex policy fields should store minor units.
- Cover both route protection and hidden-card behavior with focused frontend tests.

## Examples
Use shared access for route-level protection:

```tsx
<ProtectedRoute requires="manager">
  <CashControlsDashboard />
</ProtectedRoute>
```

Use a narrow policy mutation for closeout approval configuration:

```ts
await ctx.db.patch("store", storeId, {
  config: {
    ...currentConfig,
    operations: {
      ...operations,
      cashControls: {
        ...cashControls,
        varianceApprovalThreshold,
      },
    },
  },
});
```

## Related
- [Register closeout shared gate](../logic-errors/athena-register-closeout-shared-gate-2026-07-01.md)
- [Manager approval authority standard](../architecture/athena-manager-approval-authority-standard-2026-07-01.md)
- [POS operations metric redaction and cash allocation](../logic-errors/athena-pos-operations-metric-redaction-and-cash-allocation-2026-06-21.md)
