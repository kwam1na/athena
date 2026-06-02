---
title: Athena POS Idle Lookup Starts The Sale Workflow
date: 2026-06-02
category: logic-errors
module: athena-webapp
problem_type: pos_idle_lookup_sale_start_gap
component: pos-register
symptoms:
  - "A signed-in cashier can see product lookup guidance while no sale exists"
  - "The central lookup target focuses search only after a manual New sale click"
  - "Cashier sign-in can lose the sale-start intent during local drawer bootstrap"
root_cause: lookup_readiness_was_treated_as_focus_only_instead_of_sale_workflow_entry
resolution_type: local_first_intent_preservation
severity: medium
tags:
  - pos
  - local-first
  - cashier-flow
  - terminal-authority
  - touch-targets
---

# Athena POS Idle Lookup Starts The Sale Workflow

## Problem

The POS register's idle workspace is a cashier touch target, not just a message.
When it says the register is ready for product lookup, a cashier expects a scan
or tap to enter the selling flow. If no sale has started yet, focusing search
alone leaves the register looking ready while item entry still has no sale to
write to.

The same gap can happen immediately after cashier authentication. The view model
may have a valid staff proof and an open drawer, but local drawer bootstrap can
finish after the first sale-start attempt. Clearing the autostart intent before
`session.started` is durable leaves the cashier signed in with only a manual
`New sale` recovery path.

## Solution

Treat idle lookup as the workflow entry point while preserving POS authority
rules:

- Cashier authentication records a sale-start intent only for a real
  `StaffAuthenticationResult`. Restored staff ids stay idle so reload, clear,
  and completion replays do not resurrect sales.
- The autostart intent remains pending until the local command gateway records
  `session.started`. Local read-model sequence changes can retry the same
  intent after drawer bootstrap becomes sellable.
- The idle product-lookup touch target starts a new sale when the register is
  signed in, has no active sale, and the normal `New sale` action is enabled.
  Once the view model reports an active sale, the same target focuses product
  search.
- Quantity controls use direct numeric inputs and larger touch targets, but cart
  writes still go through the same local cart command and trusted availability
  checks.
- Terminal access remains store-scoped. Original terminal registrant ownership
  is not an exclusive guard for staff authentication, runtime status, or
  re-registration when the current user has store authority.

## Regression Targets

- Register view-model tests should prove cashier sign-in autostarts a local sale
  after delayed drawer bootstrap and after stale cloud active-session summaries.
- Register view-model tests should prove autostart does not duplicate starts or
  resurrect locally completed or cleared sales after reload.
- POS register view tests should prove the idle lookup workspace starts a sale
  before focusing search when the register is signed in but idle.
- Product and cart component tests should prove typed quantities flow into local
  cart events and reject quantities beyond trusted availability.
- Terminal command/public tests should prove non-owner authorized store users
  can authenticate and re-register terminals without exposing sync secrets.

## Prevention

- Do not make product lookup controls depend on a separate manual `New sale`
  click when the register can start a sale safely.
- Do not clear a user workflow intent until the local-first command that
  satisfies it has succeeded.
- Do not broaden autostart to every signed-in idle state. Tie it to explicit
  cashier authentication or direct lookup activation to avoid sale resurrection
  from replayed local history.
- Keep POS touch-target improvements at the presentation edge. Availability,
  drawer, staff, and terminal authority remain enforced by the local command
  gateway and Convex terminal command boundaries.

## Related

- [Athena POS Register Commands Are Always Local First](../architecture/athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Local Staff Authority](../architecture/athena-pos-local-staff-authority-2026-05-14.md)
- [Athena POS Stale Terminal Sale Blocks](./athena-pos-stale-terminal-sale-block-2026-05-29.md)
- [Athena POS Terminal Health Visibility](../architecture/athena-pos-terminal-health-visibility-2026-05-20.md)
