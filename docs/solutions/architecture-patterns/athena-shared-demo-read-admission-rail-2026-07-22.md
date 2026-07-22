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
tags: [athena, convex, read-admission, shared-demo, authz, operations, pos]
delivery_diff_fingerprint: ee57fb63b15b352657f271cfffcdd31432428a048d590d332ee48fae8b807f0a
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

After that proof held, the same rail onboarded the remaining demo-visible Operations work-item and daily-close reads, cash controls dashboard/register reads, POS transaction/session/register/terminal/telemetry reads, and the Stock Adjustments cycle-count draft reads discovered during browser validation. A later POS register pass added the behind-the-scenes register catalog reads (`search`, snapshot, revision, availability, availability snapshot, and barcode lookup), active/held POS session reads, the staff roster read, the POS service catalog read, and the daily-opening snapshot used by the register opening guard.

Migrated read and write surfaces no longer call the ad hoc shared-demo capability probe after admission resolves the actor. Daily opening now requires store membership before building even a redacted snapshot, then derives manager evidence visibility from `membership.role === "full_admin"` so redaction remains a membership decision. The public storefront `onlineOrder.get` query intentionally stays customer-channel compatible; the admitted operator/demo order-detail path is `onlineOrder.getForOperations`.

Protected external effects are enforced in the shared-demo operation adapter. A mutation can be admitted for the actor, scope, and readiness boundary only if its protected gateways are simulated by shared-demo policy; denied gateways such as `payment.refund` stop before the domain handler runs.

## Why This Matters

Read admission is a boundary decision, not a UI convenience. A shared-demo actor should be able to view only the server-owned demo tenant scope, and that viewing authority should not imply that the same actor can write operational state.

Keeping read intent separate from write capability prevents accidental broadening. Future migrations can onboard each public query by adding a definition, wrapping the exported handler, and proving the normal-user path plus shared-demo scope behavior with focused tests.

## Prevention

- Do not use write capabilities to authorize read-only shared-demo views.
- Do not treat a route gate or component condition as sufficient Convex read authorization.
- For each migrated read, test the exported query handler so admission executes before the domain helper.
- Cover same-store non-member denial as well as shared-demo same-store admission and cross-store denial. The rail authenticates actors; domain membership checks still decide whether a normal user may read store data.
- Keep follow-up migrations inventory-driven: prove one route, sweep linked demo routes, and onboard any remaining read crash by adding a definition, a public query wrapper, and focused shared-demo scope tests.
- When a query also serves unauthenticated customer-channel traffic, keep that public API unchanged and add a separate admitted operator/demo query instead of forcing Athena auth onto the customer path.
- Enforce protected gateway effects in the shared-demo adapter, not in scattered handler-local checks.
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
