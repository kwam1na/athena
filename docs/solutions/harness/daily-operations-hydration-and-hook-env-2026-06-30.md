---
title: Daily Operations Hydration Should Be Split From Hook-Safe Delivery Checks
date: 2026-06-30
category: harness
module: athena-webapp
problem_type: performance_regression
component: daily-operations
symptoms:
  - "Daily Operations analytics loaded too much data through one snapshot"
  - "Compact UI panes either felt empty or re-rendered unrelated analytics"
  - "Pre-push fixture repositories failed or flipped assertions when Git hook environment leaked into nested Git commands"
root_cause: boundary_mismatch
resolution_type: architecture
severity: medium
tags:
  - daily-operations
  - store-pulse
  - convex
  - hydration
  - git-hooks
---

# Daily Operations Hydration Should Be Split From Hook-Safe Delivery Checks

## Problem

Daily Operations had two related boundary problems. The UI wanted the week strip
and sales trend to feel immediately useful, while heavier store-pulse detail
data needed a separate hydration path. Folding every pane into the same snapshot
made the Convex read path expensive and made later UI hydration redraw unrelated
surfaces.

The delivery harness then exposed a second boundary issue. Some validation code
spawns nested fixture repositories during Git hooks. Those subprocesses inherit
hook-provided `GIT_*` variables unless the harness clears them, so a fixture Git
command can accidentally operate against the outer repository/index instead of
the fixture work tree.

## Solution

Keep Daily Operations data reads split by operator intent:

- The base daily snapshot should carry the immediately visible store-day
  metrics and lightweight weekly summary.
- Week-level analytics can be cached and reused for the week strip and selected
  day sales trend.
- Store pulse detail should hydrate through its own request boundary so top
  items, payment mix, and timeline detail can load without invalidating the
  chart or forcing another broad snapshot read.
- Timeline preview should also be its own compact query when the UI only needs
  the latest entries.

For harness and delivery scripts, every Git subprocess that may run inside a
Git hook should use a sanitized environment that removes inherited `GIT_*`
variables. This is production harness behavior, not only test fixture behavior,
because pre-push and pre-commit hooks routinely execute nested Git commands.

## Prevention

- Do not add heavyweight analytics to `getDailyOperationsSnapshot` just because
  a Daily Operations subcomponent needs them. Prefer a separately cached query
  with a stable shell in the UI.
- When a hydrated pane updates, keep unrelated chart and week-strip inputs
  referentially stable so animations do not replay from unrelated data changes.
- For nested fixture repos or provider-evidence writers, sanitize `GIT_*` before
  invoking Git. This includes `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE`,
  plus any future hook-scoped Git variables.
- Validate hook-safe changes with both focused tests and the full root harness:
  `bun test scripts/harness-inferential-review.test.ts scripts/pr-athena-delivery-run.test.ts`
  and `bun run harness:test`.
