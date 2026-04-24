---
title: Athena POS Drawer Invariants Belong At Command Boundaries
date: 2026-04-24
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "POS UI hid sale controls when no cash drawer was open, but backend item commands could still mutate a sale"
  - "Recovered sales could be visually paused while direct Convex mutations still added or updated cart lines"
  - "Cart removal, cart clear, and payment sync paths can become hidden bypasses when only product-add is guarded"
  - "Drawer validation existed for start, resume, bind, and complete flows but not every sale mutation boundary"
root_cause: invariant_gap
resolution_type: code_fix
severity: high
tags:
  - pos
  - cash-drawer
  - command-boundary
  - convex
  - recovery
---

# Athena POS Drawer Invariants Belong At Command Boundaries

## Problem

Athena POS requires an open cash drawer before a cashier can use a live sale. A frontend drawer gate can hide product entry, cart, and checkout controls, but that does not protect direct command calls or stale clients. The invariant must also live in the Convex command path that mutates the sale.

## Symptoms

- The register view correctly rendered a drawer recovery gate after refresh, but command tests could still add or update cart lines on an active session with no `registerSessionId`.
- Completion guarded closed or mismatched drawers, while sale-state mutations only checked active session status, expiry, and cashier.
- The bug was easy to miss because visible workflows were blocked by UI state.

## Solution

Validate drawer binding at shared command boundaries before mutating inventory, cart, or payment state:

```ts
const validation = validateActiveSession(session, staffProfileId, now);
if (validation.status !== "ok") return validation;

const drawerValidation = await validateActiveSessionRegisterBinding(
  dependencies,
  validation.data,
  "Open the cash drawer before modifying this sale.",
);
if (drawerValidation.status !== "ok") return drawerValidation;
```

The drawer validator should require:

- A persisted `posSession.registerSessionId`.
- A matching `registerSession` row.
- The same store.
- An open or active drawer status.
- Matching terminal and/or register number identity.

For recovery, bind the preserved session to the newly opened drawer before allowing sale mutation. Do not create a replacement POS session, because that can drop cart, customer, or payment draft state.

## Prevention

- Treat UI gates as ergonomics, not authorization or invariant enforcement.
- Add command-level tests for missing, closed, and mismatched drawer bindings whenever a POS mutation assumes an open drawer.
- Reuse the same identity/status validation for start, resume, bind, item mutation, item removal, cart clear, payment sync, and completion flows.
- Keep recovery flows idempotent: if the session is already bound to the same drawer, return success without mutating unrelated sale state.

## Related Issues

- Linear: V26-373, V26-374, V26-375, V26-376, V26-377, V26-378.
