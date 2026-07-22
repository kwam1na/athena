---
title: Athena Shared Demo Read Admission Rail
date: 2026-07-22
category: docs/solutions/architecture-patterns
module: Athena Convex public read admission
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: high
applies_when:
  - "A public Convex query needs actor-specific shared-demo admission before building a user-visible read model"
  - "A shared-demo read surface is using ad hoc store checks or write capability bridges"
  - "A migration wave needs exact read inventory coverage while reporting reads stay out of scope"
tags: [athena, convex, read-admission, shared-demo, authz, operations]
delivery_diff_fingerprint: 89232f62961769d6e539e8efa47b12cd5138cd3d9e15ddf5153f058807b44090
---

# Athena Shared Demo Read Admission Rail

## Problem

Shared-demo read behavior was spread across helper-level store checks and read-capability bridges. That made viewing paths easy to confuse with write authority, especially where Operations viewing used `daily_operations.write` to let the demo enter a read-only Daily Operations snapshot.

## Solution

Use a query counterpart to the operation admission rail:

- Declare read metadata in `packages/athena-webapp/convex/operationAdmission/readDefinitions.ts`.
- Wrap exported public query handlers with `admitSharedDemoPublicQuery(...)` from `packages/athena-webapp/convex/operationAdmission/publicQuery.ts`.
- Keep read admission metadata on explicit read intents such as `daily_operations.view`, not platform write capabilities.
- Resolve normal-user and shared-demo actors in read adapters before the domain read model runs.
- Clamp shared-demo reads to the actor's server-owned organization and store.
- Keep reporting reads out of this migration wave; `reports.read` remains the explicit hidden-workspace bridge.

The proving path is Daily Operations viewing. Its exported snapshot queries now enter through read admission before calling the snapshot builder, and `authorizeDailyOperationsSnapshot` derives the admitted actor from `ctx.operationAdmission` instead of asking the shared demo for `daily_operations.write`.

After that proof held, the same rail onboarded the remaining demo-visible Operations work-item and daily-close reads, cash controls dashboard/register reads, POS transaction/session/register/terminal/telemetry reads, and the Stock Adjustments cycle-count draft reads discovered during browser validation. The cycle-count helper keeps the legacy capability bridge for write and fallback paths, but admitted read actors bypass the old ad hoc demo capability probe.

## Why This Matters

Read admission is a boundary decision, not a UI convenience. A shared-demo actor should be able to view only the server-owned demo tenant scope, and that viewing authority should not imply that the same actor can write operational state.

Keeping read intent separate from write capability prevents accidental broadening. Future migrations can onboard each public query by adding a definition, wrapping the exported handler, and proving the normal-user path plus shared-demo scope behavior with focused tests.

## Prevention

- Do not use write capabilities to authorize read-only shared-demo views.
- Do not treat a route gate or component condition as sufficient Convex read authorization.
- For each migrated read, test the exported query handler so admission executes before the domain helper.
- Keep follow-up migrations inventory-driven: prove one route, sweep linked demo routes, and onboard any remaining read crash by adding a definition, a public query wrapper, and focused shared-demo scope tests.
- Keep reporting reads separate unless the hidden reporting workspace is explicitly in scope.

## Examples

Before, Daily Operations viewing relied on a write-shaped demo bridge:

```ts
await requireSharedDemoStoreCapabilityIfApplicable(
  ctx,
  "daily_operations.write",
  args.storeId,
);
```

After, the exported query declares read intent and admits the actor before the handler:

```ts
export const getDailyOperationsSnapshot = query({
  args: dailyOperationsSnapshotArgsValidator,
  handler: admitSharedDemoPublicQuery(
    getDailyOperationsSnapshotReadDefinition,
    async (ctx, args) => buildDailyOperationsSnapshotWithCtx(ctx, args),
  ),
});
```

## Related

- `docs/solutions/architecture-patterns/athena-operation-admission-rail-2026-07-21.md`
- `docs/solutions/architecture-patterns/shared-demo-principal-policy-and-restore-boundary-2026-07-12.md`
- `docs/solutions/security-issues/pos-public-surface-authz-and-rejected-sale-loss-2026-07-15.md`
