---
title: Athena PR Validation Requires Compounding For Substantial Work
date: 2026-05-05
category: harness
module: repo
problem_type: missing_guardrail
component: pr-validation
symptoms:
  - "A large feature PR could land even when its planned docs/solutions note was missing"
  - "Fresh delivery context was lost before the reusable lesson was captured"
root_cause: missing_validation
resolution_type: guardrail
severity: medium
tags:
  - compound
  - docs-solutions
  - pr-validation
  - delivery
---

# Athena PR Validation Requires Compounding For Substantial Work

## Problem

Athena delivery already expects agents to make a compounding decision before
handoff, but the repo did not verify that substantial implementation work
actually carried a `docs/solutions/` artifact. A plan could name the intended
solution doc, the implementation could land, and the missing doc would only be
noticed later.

## Solution

`bun run compound:check` now runs inside `pr:athena`. The check enforces two
repo-local invariants:

- Changed markdown that references a `docs/solutions/**/*.md` path must point to
  an existing file.
- Substantial behavior-bearing source changes must include a changed
  `docs/solutions/**/*.md` note.

The source threshold intentionally ignores generated files, test files, and
docs-only changes. The goal is to catch meaningful implementation deliveries,
not to require a learning document for every small edit.

## Why This Works

The skill workflow still owns the judgment call about what should be
documented. The repo sensor covers the failure mode where that judgment was made
but never materialized, or where a large behavior change reaches merge-ready
validation without any durable learning artifact.

Referential checks catch the exact plan-doc gap: if a requirements or plan file
names a solution document, that path has to exist before the branch can pass.
The line-threshold check covers large work that never added an explicit
reference.

## Prevention

- Keep `bun run compound:check` in `pr:athena`.
- When a plan lists a future `docs/solutions/` path, create or update that file
  before merge-ready handoff.
- Do not satisfy the gate with empty documentation. The note should capture the
  reusable boundary, failure mode, command, or workflow decision future agents
  need.
- If a large change truly has no reusable learning, split the work smaller or
  adjust the sensor with a focused test case that explains the exception.
