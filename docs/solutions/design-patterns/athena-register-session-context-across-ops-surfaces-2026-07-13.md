---
title: Register session context across operations surfaces
date: 2026-07-13
category: design-patterns
module: Athena cash controls, Daily Operations, and POS transactions
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "An operator follows a register session from Cash Controls to transaction history"
  - "Daily Operations needs to communicate automation completion without hiding live status"
  - "A cash-control summary needs sales or item context without changing financial authority"
related_components: ["convex", "cash-controls", "daily-operations", "pos-transactions"]
tags: [register-session, cash-controls, daily-operations, transactions, operator-context]
delivery_diff_fingerprint: dc61e75c9bca94a5fece01f5176195768095d7e1701acabe857c0592ecab8fae
---

# Register session context across operations surfaces

## Problem

Cash Controls, Daily Operations, and POS transactions can describe the same
register session from different starting points. If a route drops the operating
date or session identity, or a summary only exposes money without its sales
context, the operator has to reconstruct the workflow manually. Automation
completion also must not displace the current operational status that explains
what still needs attention.

## Solution

Keep the register session as the shared operator context at each handoff.

- Attach `openedOperatingDate` and `registerSessionId` when Cash Controls opens
  the transaction history so the destination starts with the relevant period
  and drawer selected.
- Build transaction filters from URL state, reset pagination whenever a payment
  method changes, and render an empty state that names the active date, payment,
  or register constraint.
- Return bounded session-scoped sales totals and an item breakdown from the
  Cash Controls read model. Present those as decision-support detail; preserve
  the existing closeout cash figures as the financial authority.
- Place an automation completion event in the current Daily Operations status
  band with other timestamped automation updates. When that band is absent,
  retain the top-level completion treatment instead of rendering the fact twice.

For example, the handoff retains both identifiers:

```tsx
search={{
  operatingDate: registerSession.openedOperatingDate,
  registerSessionId: registerSession._id,
}}
```

## Why This Matters

The cash-control view answers the drawer and closeout question; transaction
history answers the sale question; Daily Operations answers what needs action.
Passing the same session context between them keeps those jobs distinct while
letting an operator investigate one real workflow without losing their place.

## Prevention

- Test route handoffs, payment-filter URL updates, and empty-state copy with a
  session identifier and operating-date constraint.
- Test automation completion both with and without visible live statuses so it
  appears once in the appropriate Daily Operations band.
- Keep session summaries bounded and derived from the existing register-session
  scope; do not replace closeout calculations with presentation-only sales data.

## Related

- `docs/solutions/design-patterns/athena-register-closeout-variance-alerts-and-ops-ia-2026-07-08.md`
- `docs/solutions/logic-errors/athena-operator-context-and-filter-boundaries-2026-07-03.md`
