---
title: Landed Change Report Gate
date: 2026-07-09
category: harness
module: repo
problem_type: missing_handoff_guardrail
component: landed-change-report-check
resolution_type: guardrail
severity: medium
delivery_diff_fingerprint: a35446754ec96c1370bd49b8b06f421c320fe8abbfdc0f939bb234c2993ecb1b
tags:
  - delivery-handoff
  - reports
  - validation
---

# Landed Change Report Gate

## Problem

Large source branches can land with enough behavioral or architectural context that a normal PR
description and final Linear comment are not enough for a human reader to understand the change.
The `execute` workflow now expects a digestible landed-change report for substantial delivery
handoffs, but without a repo sensor that expectation can drift under time pressure.

## Solution

Add `scripts/landed-change-report-check.ts` and wire `landed-report:check` into the
`pr:athena:validate-provider` pipeline. The sensor totals reportable source-line changes against
`origin/main` using the same branch-aware approach as `compound:check`. When the branch crosses the
large-change threshold, it requires a changed HTML report under `docs/reports/`.

The check also verifies that changed report artifacts look like outputs from the repo-local
`.agents/skills/ce-landed-change-report` workflow: they must carry the report marker, subagent
evidence section, and pass-required quiz form.

Run the same sensor in `pre-push:review` immediately after `compound:check` so review-loop edits
that stale the report fingerprint fail locally before PR validation or merge.

## Prevention

Keep the report gate in `pr:athena:validate-provider` beside `compound:check`, and update
`scripts/landed-change-report-check.test.ts` whenever the landed-change report contract changes.
Use the repo-local `.agents/skills/ce-landed-change-report` skill for report creation so generated
reports satisfy the sensor and preserve the required human comprehension handoff.
