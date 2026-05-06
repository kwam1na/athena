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
  - "Parallel subagent execution could satisfy implementation tickets while missing the final compounding deliverable"
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
- Compound-sensitive workflow changes must include a changed
  `docs/solutions/**/*.md` note even when the line count is small.
- Changed solution notes must include the expected frontmatter and the
  `Problem`, `Solution`, and `Prevention` sections.

The source threshold intentionally ignores generated files, test files, and
docs-only changes. The goal is to catch meaningful implementation deliveries,
not to require a learning document for every small edit.

The workflow-sensitive path list covers repo delivery and validation surfaces:
compound checks, pre-push/pre-commit repair scripts, harness scripts, coverage
and architecture gates, GitHub workflow files, Husky hooks, package command
wiring, and the core delivery skills. These files change how future agents
deliver work, so small edits there can be more reusable than a larger ordinary
component change.

## Why This Works

The skill workflow still owns the judgment call about what should be
documented. The repo sensor covers the failure mode where that judgment was made
but never materialized, or where a large behavior change reaches merge-ready
validation without any durable learning artifact.

Referential checks catch the exact plan-doc gap: if a requirements or plan file
names a solution document, that path has to exist before the branch can pass.
The line-threshold check covers large work that never added an explicit
reference.

The quality check keeps the gate from becoming a checkbox. A changed
`docs/solutions/` file needs enough structure for a future agent to understand
the problem, the fix, and the prevention rule. Placeholder notes fail in the
same command that would otherwise accept them.

## Prevention

- Keep `bun run compound:check` in `pr:athena`.
- When a plan lists a future `docs/solutions/` path, create or update that file
  before merge-ready handoff.
- Do not satisfy the gate with empty documentation. The note should capture the
  reusable boundary, failure mode, command, or workflow decision future agents
  need.
- Treat the final integration branch as the unit of compounding. Parallel
  subagent work is evaluated in aggregate, so the final branch needs the durable
  learning artifact even if no single worker owned the note.
- If a large change truly has no reusable learning, split the work smaller or
  adjust the sensor with a focused test case that explains the exception.
