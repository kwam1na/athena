---
title: Landed Change Report Gate
date: 2026-07-09
last_updated: 2026-07-13
category: harness
module: repo
problem_type: missing_handoff_guardrail
component: landed-change-report-check
resolution_type: guardrail
severity: medium
delivery_diff_fingerprint: dc61e75c9bca94a5fece01f5176195768095d7e1701acabe857c0592ecab8fae
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

Add `scripts/landed-change-report-check.ts` and wire it with `compound:check` through
`scripts/delivery-documentation-check.ts`. The composite `delivery:documentation-check` runs both
policies before reporting, so a branch that lacks a solution note and a landed-change report gets
one actionable failure containing both requirements. The report sensor totals reportable source-line changes against
`origin/main` using the same branch-aware approach as `compound:check`. When the branch crosses the
large-change threshold, it requires a changed HTML report under `docs/reports/`.

The check also verifies that changed report artifacts look like outputs from the repo-local
`.agents/skills/ce-landed-change-report` workflow: they must carry the report marker, subagent
evidence section, and pass-required quiz form.

Run the composite policy in `pre-push:review` and CI as one documentation step so review-loop
edits that stale either artifact are reported together before PR validation or merge.

## Prevention

Keep `delivery:documentation-check` in `pr:athena:validate-provider`, `pre-push:review`, and CI.
Update `scripts/delivery-documentation-check.test.ts` whenever either policy's aggregate reporting
or remediation guidance changes, and retain the individual sensor tests for their own contracts.
Use the repo-local `.agents/skills/ce-landed-change-report` skill for report creation so generated
reports satisfy the sensor and preserve the required human comprehension handoff.
