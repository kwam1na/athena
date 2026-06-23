---
title: Athena POS Register Lifecycle Policy Boundary
date: 2026-06-23
category: architecture
module: athena-webapp
problem_type: pos_register_lifecycle_policy_drift
component: pos
symptoms:
  - "Browser-local POS and Convex projection can disagree about whether a drawer is sale-usable"
  - "Submitted closeout reviews can accidentally become either hard sale blockers or reusable drawers depending on the layer"
  - "Direct cloud register-session ids can bypass local-id-specific guards if sale usability is checked ad hoc"
root_cause: drawer_lifecycle_rules_were_reimplemented_across_projection_view_model_runtime_and_repository_paths
resolution_type: shared_pure_lifecycle_policy
severity: high
tags:
  - pos
  - drawer-lifecycle
  - local-first
  - cash-controls
  - sync
---

# Athena POS Register Lifecycle Policy Boundary

## Problem

The register drawer lifecycle is consumed in several places:

- browser-local read models and command gateways decide whether a cashier can
  sell, reopen, close out, or open a replacement drawer;
- local runtime sync decides whether `needs_review` lifecycle events should
  keep the terminal in a blocking review state;
- Convex projection decides whether synced local events can reuse an existing
  cloud drawer, supersede a reviewed drawer, or project a sale; and
- Cash Controls and Daily Close present closeout-review state to operators.

When each layer encodes the rule locally, they drift. The dangerous cases are
not simple status checks. A `closing` drawer is not sale-usable, but a submitted
closeout review can allow a new local drawer under a new register-session
scope. A `cloud_closed` drawer authority block is hard for sale reuse but can
allow replacement drawer opening. A direct cloud register-session id should not
skip an open closeout-review check just because the local id string equals the
cloud id.

## Decision

Keep drawer lifecycle decisions in a pure shared policy module:

`packages/athena-webapp/shared/registerSessionLifecyclePolicy.ts`

Callers adapt their local facts into structural policy inputs. The policy must
not import React, Convex table types, local-store adapters, or repositories.

Repositories stay on the fact side of the boundary. They can answer questions
such as "is there an open closeout review for this mapped register session?"
and return ordering or mapping evidence, but application/sync code asks the
shared policy what those facts mean.

## Solution

Extract the drawer lifecycle predicates into
`shared/registerSessionLifecyclePolicy.ts` and make each layer call it at the
decision point:

- the local read model asks the policy which drawer-authority facts block
  sales;
- the local command gateway asks whether a sale block still permits opening a
  replacement drawer;
- runtime sync diagnostics ask which lifecycle review events are non-blocking;
- Convex projection asks whether a cloud drawer can be reused or superseded
  before mapping a local open;
- repository code uses the shared closeout-review classifier while still only
  reading conflict and mapping facts; and
- Cash Controls and Daily Close consume the same sale-usability and
  closeout-review classifications as the projection layer.

## Invariants

- `open` and `active` are sale-usable.
- `closing` is not sale-usable.
- `closed` is historical unless an explicit reviewed replay path allows a
  specific projection.
- Submitted closeout review state can make a new drawer eligible under a new
  register-session scope; it does not make the reviewed drawer sale-usable.
- Settled closeout history releases its own blocker and must not block the next
  drawer for the same store and terminal.
- `cloud_closed` drawer authority blocks sale reuse and can allow replacement
  drawer opening.
- `lifecycle_rejected` for the same local drawer is recoverable local evidence,
  not a hard sale blocker by itself.
- Non-blocking register lifecycle review events are `needs_review`
  `register.opened` and `register.closeout_started` events.
- Closeout-review conflict classification uses one shared summary and shape
  predicate so projection, repository facts, and Cash Controls review state do
  not fork.

## Regression Targets

- Shared policy tests should cover sale usability, drawer-authority blocking,
  replacement drawer eligibility, cloud drawer reuse, reviewed drawer
  supersession, closeout-review conflict classification, and non-blocking
  lifecycle review events.
- Local read-model and command-gateway tests should prove command-boundary
  enforcement matches UI readiness.
- Projection tests should prove direct cloud register-session ids still conflict
  when the mapped drawer has an open closeout review.
- Runtime sync tests should prove uploaded lifecycle review events do not keep
  terminal runtime status in a blocking review state.
- Cash Controls and Daily Close tests should prove submitted closeout review is
  visible/reviewable without making the drawer sale-usable.

## Prevention

- Do not add new POS drawer status sets in browser or Convex code. Add a policy
  helper when a new lifecycle question appears.
- Keep helper names behavior-specific: sale usability, replacement eligibility,
  cloud drawer reuse, runtime inspection, review classification.
- Do not move repository access into the policy module. Convert repository rows
  into plain inputs at the application boundary.
- Treat "reuse the current drawer" and "open a replacement drawer" as different
  decisions. They intentionally have different answers for reviewed closeouts
  and closed cloud drawers.
