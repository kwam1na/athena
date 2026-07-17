---
title: Register session context across operations surfaces
date: 2026-07-13
last_updated: 2026-07-17
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
delivery_diff_fingerprint: 853fb788d93e866c6e53476670527182214b6dd23c708e5bcada66044fe5eb5f
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
- Return a normalized register identity contract from both activity and trace
  queries, then render it through one shared presentation component. Treat the
  session subject as the primary lookup and a distinct legacy register ID as a
  compatibility fallback; a stale primary subject must not suppress a valid
  legacy match.
- Scope terminal labels to the active store before including them in the
  operator header. A historical or malformed cross-store reference may still
  identify the register by number, but it must not disclose another store's
  terminal name.
- Place an automation completion event in the current Daily Operations status
  band with other timestamped automation updates. When that band is absent,
  retain the top-level completion treatment instead of rendering the fact twice.
- Keep TanStack route definition modules focused on route declarations by
  moving page and layout implementations into hyphen-prefixed companion files.
  This preserves generated route discovery while keeping Fast Refresh exports
  component-safe.

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
- Test populated, generic, stale-primary, legacy-fallback, and cross-store
  identity cases at the Convex response boundary and in each shared header.
- Test automation completion both with and without visible live statuses so it
  appears once in the appropriate Daily Operations band.
- Keep session summaries bounded and derived from the existing register-session
  scope; do not replace closeout calculations with presentation-only sales data.
- Keep route definition files limited to route exports; place reusable UI and
  presentation helpers in dedicated modules so the Fast Refresh lint rule stays
  clean.

## Related

- `docs/solutions/design-patterns/athena-register-closeout-variance-alerts-and-ops-ia-2026-07-08.md`
- `docs/solutions/logic-errors/athena-operator-context-and-filter-boundaries-2026-07-03.md`
