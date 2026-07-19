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
  - "A configured shared demo, including the deliberate production experience, must use real tenant workflows without inheriting full administrator effects"
  - "Many visitors write to one synthetic store that must return to an exact baseline"
tags:
  - shared-demo
  - authentication
  - authorization
  - effect-policy
  - convex
  - restore-fence
delivery_diff_fingerprint: d0092bd6fc5b6625cca578a2214d584436307f365f8beeff5ab92f196b783d12
---

# Shared demo principal policy and atomic restore boundary

## Problem

A shared demo must feel like Athena because visitors use the same POS, inventory, cash, fulfillment, staff, operations, and reporting paths as a real store. Mapping every visitor to an ordinary `full_admin` user is unsafe, however: membership checks alone also authorize identity, permissions, exports, integrations, payments, refunds, destructive administration, and provider-backed effects.

The shared store also needs a deterministic reset. A parallel manifest or UI-only reset does not restore Athena's real source and child rows, and a restore pre-check outside the business transaction allows a stale write to land after the baseline is published.

## Solution

Treat shared-demo access as a distinct server-derived principal layered on top of normal authentication:

- Mint a short-lived opaque admission ticket only when `ATHENA_SHARED_DEMO_ENABLED=true` and `STAGE` is one of the explicitly supported stages (`dev`, `qa`, or `prod`). Production support is deliberate. A deployment-ID allowlist and an additional environment variable were considered and rejected; the supported-stage plus explicit-feature-flag boundary is the product decision.
- Create a distinct Convex Auth user/principal for each admission while mapping every principal to the same synthetic Athena owner, organization, and store.
- Store only the ticket hash, consume it transactionally once, and enforce a non-renewable server-clock expiry for that exact principal.
- Resolve demo mode from the authenticated user and durable principal row. Never accept demo kind or store authority from the client.

At write boundaries, normal actors retain existing behavior. Demo actors pass through a closed capability registry. Real writes are explicitly classified; protected and unknown writes fail closed. Provider-backed effects have a second classification boundary so an allowed business mutation cannot enqueue a live email, message, export, payment, refund, or integration effect later.

Restore the real store through one versioned registry of store-scoped source and child tables. Provision a coherent synthetic foundation once, capture exact baseline documents, and use one singleton restore state as a durable lease and monotonic epoch. The lease mutation persists its idempotency key and schedules continuation in the same transaction. Apply records a stable receipt; completion publishes `ready` only from that receipt and only after queued terminal cleanup is empty. Retries join or replay the same lease instead of starting a competing restore. Every allowed demo mutation reads the epoch in the same Convex transaction as its business write. Restore deletes visitor-added rows, replaces modified baseline rows, verifies the complete source/reporting projection closure through bounded indexed traversal, and publishes no false-ready state after failure.

## Why This Matters

An Athena user role answers what a normal operator may do; it does not express the smaller effect envelope of a public shared demo. A dedicated principal and operation policy preserve real application behavior without turning the demo owner into a reusable administrator credential.

Per-admission auth users prevent a newer visitor from extending every older browser's authority. Same-transaction restore-epoch reads turn restore/write races into Convex conflicts instead of mixed baselines. Restoring actual domain tables keeps POS, inventory, cash, orders, staff communication, Daily Operations, and Reports grounded in one source of truth.

## Prevention

- Keep the source-derived exported-function and external-gateway inventory current. New surfaces are discovered automatically and default to denied until explicitly classified.
- Put demo capability checks inside the actual mutation/action boundary, before provider calls or durable writes. Hiding a route or control is never sufficient.
- Clamp store and organization authority to the server-owned principal. Reject cross-store IDs even when the normal user is a full administrator.
- Add every newly demo-writable table, including child rows, to the baseline registry or rebuild it deterministically after restore.
- Query each baseline table through an index that actually exists in the deployed schema. A compound index with `storeId` first is valid for store-prefix capture even when there is no standalone `by_storeId` index.
- Schedule continuation in the same transaction that acquires the restore lease. Persist an apply receipt before publishing `ready`, and make apply/complete idempotent against that receipt.
- Treat missing-state bootstrap as recovery, not permission to capture live data. Count every table in the mutable registry and validate deterministic seed markers—including credentials and their lockout state—before capturing a baseline.
- Queue browser-terminal cleanup on the durable lease. Do not report deletion before apply processes it, and never publish `ready` while queued cleanup remains.
- Let provisioning own baseline-version migration. Restore must reject stale state or snapshot versions before it begins, otherwise a scheduled restore can promote old seed semantics before migration runs.
- Classify baseline migrations by operational impact. For credential or presentation-only changes, promote existing snapshots in place, transform only the affected baseline documents, and preserve the restore epoch; recapturing live state can canonize visitor activity, while restoring POS sync snapshots or incrementing the epoch can split the browser and server sequence histories. Reserve a full restore and epoch change for migrations that intentionally reset operational state.
- Make allowed demo mutations read `sharedDemoRestoreState.epoch` in the same transaction as their write.
- Treat the restore epoch and restore status as one frontend fence. A new epoch is published while the lease is still `restoring`, so browser-local POS reset and baseline binding must wait for `ready`, keep POS gated in the meantime, and react again when that same epoch transitions from `restoring` to `ready`. Otherwise a failed early bind can leave IndexedDB pointing at a cloud register session the restore has deleted.
- Keep synthetic seed data coherent and avoid unsupported reporting claims. Rematerialize only existing Reports relationships.
- Test expired-principal behavior explicitly. An expired demo principal must throw; it must never fall through as a normal actor.
- Gate frontend demo subscriptions on the configured shared-demo runtime state, not on a development-only assumption. The production demo is supported when its backend has `ATHENA_SHARED_DEMO_ENABLED=true`, a supported `STAGE`, and the configured synthetic Athena user, organization, and store IDs.
- Validate those configured IDs as one synthetic foundation before admission or baseline capture: the Athena owner, organization, and store relationships must agree and the deterministic seed markers must be complete. This narrow foundation check prevents the demo principal from becoming authority over an arbitrary tenant without inventing a rejected deployment-ID allowlist.
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
