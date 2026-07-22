---
title: Athena Operation Admission Rail
date: 2026-07-21
last_updated: 2026-07-21
category: docs/solutions/architecture-patterns
module: Athena Convex public write admission
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: high
applies_when:
  - "A public Convex mutation needs actor-specific policy before any domain write"
  - "Shared-demo write access must use the same domain path as normal users without becoming full administrator auth"
  - "A migration wave needs exact inventory coverage before all writes can move to a new admission layer"
tags: [athena, convex, operation-admission, shared-demo, authz, static-checker]
delivery_diff_fingerprint: a4f97cd08951c6d2877979d29b8e65ba729bf54ced683f9e3fc05663135d60bf
---

# Athena Operation Admission Rail

## Problem

Athena had shared-demo write policy attached to helper-level demo checks while normal users continued through ordinary authentication helpers. That made the capability catalog feel demo-owned, and it made it hard to prove that future public write migrations actually enforced actor, scope, readiness, and effect policy at the exported mutation boundary.

## Solution

Treat public write admission as a platform rail:

- Keep the Athena-wide capability catalog in `packages/athena-webapp/convex/platform/capabilityCatalog.ts`.
- Declare migrated public writes in `packages/athena-webapp/convex/operationAdmission/definitions.ts`.
- Wrap the exported `mutation({ handler })` with `admitPublicMutation(...)` so admission runs before domain writes.
- Put actor-specific rules in adapters, such as `packages/athena-webapp/convex/sharedDemo/operationAdapter.ts`.
- Keep unmigrated public writes in an exact legacy inventory under `operationAdmission/migrationInventory.ts`.
- Enforce the structure with `scripts/convex-operation-admission-check.ts`.

The important guardrail is that a definition alone is not coverage. The checker must prove both facts for a migrated public write:

```ts
export const resolveSyncedSaleInventoryReviewGroup = mutation({
  args: { /* ... */ },
  handler: admitPublicMutation(
    resolveSyncedSaleInventoryReviewGroupOperationDefinition,
    resolveSyncedSaleInventoryReviewGroupWithCtx,
    {
      resolveAdmission: (ctx, args, definition) =>
        resolveOperationAdmission(ctx, args, definition, {
          normalAdapter: createNormalUserOperationAdapter(),
          sharedDemoAdapter: createSharedDemoOperationAdapter(),
        }),
    },
  ),
});
```

After the first proving mutation, the same pattern was extended to the
shared-demo reachable POS, operations, cash-control, inventory adjustment,
staff authentication, staff message, storefront fulfillment, return/exchange,
and protected-effect declaration write groups:

- `operations/approvalRequests:decideApprovalRequest` derives the reviewer from
  the admitted operation actor when the rail admits the write.
- Shared-demo lifecycle, POS, cash-control, stock operation, staff
  authentication/message, daily-opening, terminal registration, and storefront
  fulfillment/refund-capable public writes declare operation definitions instead
  of remaining legacy shared-demo public function entries.
- Generic Athena user auth preserves the explicit `reports.read` demo bridge,
  but migrated write capabilities do not enter through that helper.

## Why This Matters

Shared demo is a real-tenant workflow with a smaller authority envelope. Normal account roles answer what an operator may do; shared-demo admission answers whether this short-lived demo principal may perform this exact operation against its server-owned store while the restore epoch is still current.

Putting the capability catalog at the platform layer prevents demo policy from becoming the source of truth for all Athena capabilities. Putting the shared-demo rules in an adapter lets normal users keep existing auth behavior while demo principals receive store/org clamps, capability allow/deny decisions, restore readiness checks, and stable policy denials before any mutation body runs.

## Prevention

- Do not remove a public write from `OPERATION_ADMISSION_LEGACY_EXEMPTIONS` until the exported mutation handler is wrapped with `admitPublicMutation`.
- Add operation definitions with stable `functionName` values that exactly match `module/path:exportName`.
- Test the exported mutation handler, not only the `WithCtx` domain helper, when proving admission behavior.
- Include denial tests for shared-demo scope mismatch and stale restore readiness.
- Run `bun scripts/convex-operation-admission-check.ts` after adding or renaming public Convex mutations.
- When a command-style public mutation expects `{ status: "user_error" }`
  results, normalize admission denial at the public handler boundary and test
  that shape instead of leaking raw shared-demo readiness errors.
- Do not add new shared-demo write capability options to generic auth helpers or
  send migrated operation-owned capabilities through that bridge; operation
  admission is the write source of truth for migrated writes.

## Examples

The initial proving mutation was
`operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup`. Its
backend test invokes the exported Convex `_handler` with a shared-demo principal
and verifies the domain path uses `operationAdmission` rather than falling back
to `requireAuthenticatedAthenaUserWithCtx`.

The wider migration adds coverage for approval decisions, shared-demo lifecycle
operations, and the V26-1096 demo-reachable write groups. Tests assert that
approval reviewers come from `ctx.operationAdmission.actor`, that generic auth
no longer receives helper-only demo write options, and that migrated operations
leave the legacy inventories once operation definitions own them.

The static checker also has a negative fixture: a public mutation with a matching operation definition but a raw `handler: async () => ...` fails. This prevents future migrations from adding definitions that document intent without enforcing runtime admission.

## Related

- [Shared Demo Principal Policy And Restore Boundary](shared-demo-principal-policy-and-restore-boundary-2026-07-12.md)
- [Operation Admission Rail Plan](../../plans/2026-07-21-001-feat-operation-admission-rail-plan.md)
