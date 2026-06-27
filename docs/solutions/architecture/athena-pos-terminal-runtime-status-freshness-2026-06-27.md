---
title: Athena POS Terminal Runtime Status Freshness
date: 2026-06-27
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: pos-terminal-health
resolution_type: workflow_improvement
severity: medium
tags:
  - pos
  - terminal-health
  - local-sync
  - runtime-status
---

# Athena POS Terminal Runtime Status Freshness

## Problem

Terminal Health detail pages can receive large support evidence sets when a
terminal has many unresolved sync conflicts, local review events, or recovery
blockers. Rendering every row at once makes the support page noisy and harder to
scan, even though operators usually need the first few items before deciding on
the next action.

Runtime status publishing also needs a freshness boundary separate from semantic
runtime changes. If the browser terminal is healthy but the material runtime
payload does not change, the cloud can age out the last check-in even though the
terminal is still alive.

## Solution

Keep the detail page support-first:

- Render only the first few conflict, local review, and recovery blocker rows by
  default.
- Add explicit expand controls per list so support staff can inspect the full
  evidence set without making the default page overwhelming.
- Keep local runtime review evidence distinct from cloud conflicts; list caps
  should not collapse either source into generic manager-review copy.

Publish runtime freshness independently from material runtime changes:

- Start a scoped heartbeat only after store id, terminal id, and sync-secret hash
  are available.
- Increment the runtime observation token on the heartbeat so the existing
  publish contract can refresh the check-in without inventing fake runtime
  changes.
- Keep the heartbeat non-blocking; failed check-ins remain diagnostic evidence
  and must not block cashier actions or local sync.

## Prevention

When changing terminal health detail lists, cover both capped and expanded
states in component tests. When changing runtime check-in freshness, cover the
timer boundary directly so the test proves unchanged runtime material can still
publish after the freshness interval.
