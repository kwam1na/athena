---
title: Athena Cross-Layer Delivery Needs Bounded Reads and Contract Proof
date: 2026-07-18
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - Shipping a broad Athena webapp change that touches Convex and operator UI surfaces
  - Changing a public Convex return validator or query projection
tags: [convex, delivery-gates, return-contracts, graphify]
delivery_diff_fingerprint: 7375794f82394e565b86017f3a6294e6f4d8564960308528fec07ddac624c7c9
---

# Athena Cross-Layer Delivery Needs Bounded Reads and Contract Proof

## Problem

A cross-layer operational batch can typecheck and pass focused UI tests while
still failing Athena's delivery gates. The gaps are usually at the boundary
between Convex runtime guarantees and the artifacts needed to hand a large
change safely to reviewers.

## Solution

Treat changed-file lint and generated-artifact checks as design feedback rather
than post-implementation chores:

- Query organization membership through its declared index, project only the
  return-validator shape, and use explicit table names for document reads and
  patches.
- Keep sync review fan-out bounded with `take(...)` instead of loading every
  matching conflict document.
- Add `assertConformsToExportedReturns(...)` coverage whenever a public Convex
  return value changes shape.
- Rebuild Graphify after code changes, then include the refreshed artifacts in
  the delivery commit.

```ts
const members = [];
for await (const member of ctx.db
  .query("organizationMember")
  .withIndex("by_organizationId_userId", (q) =>
    q.eq("organizationId", args.organizationId),
  )) {
  members.push(member);
}

assertConformsToExportedReturns(getAll, projectedMembers);
```

## Why This Matters

The database query, its return validator, and the UI consumer form one
contract. A raw document can leak fields or fail Convex validation even when
the consumer only needs a small member view. Bounded reads also prevent a
single review query from becoming unbounded as operational history grows. The
shared-demo owner is an explicit product identity exception, so its validator
must assert the expected Osu Studio address rather than apply a generic
synthetic-email rule.

## Prevention

- Run `bun run lint:convex:changed`, `bun run lint:frontend:changed`, and
  `bun run typecheck` from `packages/athena-webapp` before attempting a push.
- When a public Convex module changes, add a sibling contract test for every
  exported return validator flagged by the harness.
- For substantial source changes, add the solution note and landed-change
  report before the pre-push review gate rather than treating them as
  post-merge cleanup.

## Examples

The membership projection now returns only the declared UI shape, while the
sync-review lookup reads at most the configured review limit per conflicted
event. Focused tests cover the projected member return contract and the
operational UI behavior separately.

## Related

- [Athena Convex facade-preserving module split](../architecture-patterns/athena-convex-facade-preserving-module-split-2026-07-06.md)
- [Athena operations review and cash closeout continuity](../architecture-patterns/athena-operations-review-and-cash-closeout-continuity-2026-07-11.md)
