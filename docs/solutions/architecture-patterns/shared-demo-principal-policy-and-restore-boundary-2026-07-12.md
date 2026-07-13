---
title: Shared demo principal policy and atomic restore boundary
date: 2026-07-12
category: architecture-patterns
module: athena-webapp-shared-demo
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: high
applies_when:
  - "A non-production shared demo must use real tenant workflows without inheriting full administrator effects"
  - "Many visitors write to one synthetic store that must return to an exact baseline"
tags:
  - shared-demo
  - authentication
  - authorization
  - effect-policy
  - convex
  - restore-fence
delivery_diff_fingerprint: 5f35e2436b0b1fd5f3f67f73e25a24a3786829723c3c37b0801dfada5481e370
---

# Shared demo principal policy and atomic restore boundary

## Problem

A shared demo must feel like Athena because visitors use the same POS, inventory, cash, fulfillment, staff, operations, and reporting paths as a real store. Mapping every visitor to an ordinary `full_admin` user is unsafe, however: membership checks alone also authorize identity, permissions, exports, integrations, payments, refunds, destructive administration, and provider-backed effects.

The shared store also needs a deterministic reset. A parallel manifest or UI-only reset does not restore Athena's real source and child rows, and a restore pre-check outside the business transaction allows a stale write to land after the baseline is published.

## Solution

Treat shared-demo access as a distinct server-derived principal layered on top of normal authentication:

- Mint a short-lived opaque admission ticket only when both the feature flag and deployment-identity allowlist match.
- Create a distinct Convex Auth user/principal for each admission while mapping every principal to the same synthetic Athena owner, organization, and store.
- Store only the ticket hash, consume it transactionally once, and enforce a non-renewable server-clock expiry for that exact principal.
- Resolve demo mode from the authenticated user and durable principal row. Never accept demo kind or store authority from the client.

At write boundaries, normal actors retain existing behavior. Demo actors pass through a closed capability registry. Real writes are explicitly classified; protected and unknown writes fail closed. Provider-backed effects have a second classification boundary so an allowed business mutation cannot enqueue a live email, message, export, payment, refund, or integration effect later.

Restore the real store through one versioned registry of store-scoped source and child tables. Provision a coherent synthetic foundation once, capture exact baseline documents, and use one singleton restore state as a lease and monotonic epoch. Every allowed demo mutation reads that epoch in the same Convex transaction as its business write. Restore deletes visitor-added rows, replaces modified baseline rows, refuses to recreate destructively removed protected rows, verifies the baseline, and then rematerializes supported Reports projections. Restore errors must escape the mutation so Convex rolls back every table change atomically.

## Why This Matters

An Athena user role answers what a normal operator may do; it does not express the smaller effect envelope of a public shared demo. A dedicated principal and operation policy preserve real application behavior without turning the demo owner into a reusable administrator credential.

Per-admission auth users prevent a newer visitor from extending every older browser's authority. Same-transaction restore-epoch reads turn restore/write races into Convex conflicts instead of mixed baselines. Restoring actual domain tables keeps POS, inventory, cash, orders, staff communication, Daily Operations, and Reports grounded in one source of truth.

## Prevention

- Keep the source-derived exported-function and external-gateway inventory current. New surfaces are discovered automatically and default to denied until explicitly classified.
- Put demo capability checks inside the actual mutation/action boundary, before provider calls or durable writes. Hiding a route or control is never sufficient.
- Clamp store and organization authority to the server-owned principal. Reject cross-store IDs even when the normal user is a full administrator.
- Add every newly demo-writable table, including child rows, to the baseline registry or rebuild it deterministically after restore.
- Query each baseline table through an index that actually exists in the deployed schema. A compound index with `storeId` first is valid for store-prefix capture even when there is no standalone `by_storeId` index.
- Never catch a baseline error inside the mutation that performs table replacements. Returning a failure result would commit any earlier table writes; an uncaught error preserves the prior store transaction.
- Let provisioning own baseline-version migration. Restore must reject stale state or snapshot versions before it begins, otherwise a scheduled restore can promote old seed semantics before migration runs.
- Make allowed demo mutations read `sharedDemoRestoreState.epoch` in the same transaction as their write.
- Keep synthetic seed data coherent and avoid unsupported reporting claims. Rematerialize only existing Reports relationships.
- Test expired-principal behavior explicitly. An expired demo principal must throw; it must never fall through as a normal actor.
- Keep shared free text bounded and rate-limited, and never include visitor payloads or admission tickets in telemetry.

## Examples

Unsafe authorization shape:

```ts
const member = await requireOrganizationMemberRoleWithCtx(ctx, {
  allowedRoles: ["full_admin"],
  organizationId,
  userId,
});
// A shared demo owner now looks like an unrestricted real administrator.
```

Shared-demo-aware boundary:

```ts
const demoActor = await requireSharedDemoCapabilityIfApplicable(
  ctx,
  "inventory.adjust",
);
if (demoActor) {
  await requireReadySharedDemoWriteWithCtx(ctx, {
    expectedEpoch,
    storeId: demoActor.storeId,
  });
}
// Existing normal authorization still runs for every actor.
```

The demo guard narrows only demo principals. The normal membership, store, and domain invariants remain authoritative for all users.

## Related

- `docs/plans/2026-07-12-002-feat-shared-demo-plan.md`
- `packages/athena-webapp/docs/shared-demo-backend-coverage.md`
- Linear `V26-1039`
