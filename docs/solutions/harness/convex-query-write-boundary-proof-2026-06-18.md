---
title: Convex Query Paths Must Not Reach Write-Capable Repositories
date: 2026-06-18
category: harness
module: athena-webapp
problem_type: convex_query_write_boundary_drift
component: convex
resolution_type: read_write_repository_split_and_inferential_guard
severity: high
tags:
  - convex
  - harness
  - public-contracts
  - regression-tests
---

# Convex Query Paths Must Not Reach Write-Capable Repositories

## Problem

Convex query contexts do not expose mutation-only database methods such as
`db.patch`, `db.insert`, `db.replace`, or `db.delete`. A query can still reach
those methods indirectly when shared repositories accept `QueryCtx | MutationCtx`
and cast to `MutationCtx` inside write methods.

The production symptom was `t.db.patch is not a function` while serving the
terminal recovery command list query. The public query passed `QueryCtx` into a
write-capable terminal recovery repository, and the service path attempted to
expire stale commands by patching during a read.

## Solution

Make Convex repository capability explicit:

- Query-safe repository factories may accept `QueryCtx | MutationCtx`, but they
  should return read-only interfaces.
- Write-capable repository factories should require `MutationCtx`.
- Query/list services should compute filtered read models without persisting
  cleanup side effects.
- Mutation services should own expiry persistence, inserts, claims,
  acknowledgements, and verification writes.
- Focused tests should exercise query-shaped contexts that omit write methods,
  not only mocks that happen to provide `patch` or `insert`.

## Prevention

Use deterministic inferential review for changed Convex boundary code:

- Flag changed queries that directly call mutation-only DB methods.
- Flag changed query-facing services or repositories that accept query-compatible
  inputs and expose or call write methods.
- Include alias and cast fixtures because the risky shape often hides behind
  `type SomeCtx = QueryCtx | MutationCtx`, `ctx as MutationCtx`, or
  `ctx as unknown as MutationCtx`.
- Keep rollout changed-file scoped so existing mixed repositories can be
  migrated intentionally, while new or changed query-facing write surfaces fail
  before `pr:athena` passes.
