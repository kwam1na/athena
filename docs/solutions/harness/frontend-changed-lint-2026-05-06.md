---
title: Athena PR Validation Lints Changed Frontend Source Files
date: 2026-05-06
category: harness
module: repo
problem_type: missing_guardrail
component: pr-validation
symptoms:
  - "Frontend TypeScript files could be changed without running ESLint in the normal PR gate"
  - "Direct ESLint runs on POS register view-model files found issues that pr:athena did not catch"
root_cause: missing_validation
resolution_type: guardrail
severity: medium
tags:
  - eslint
  - frontend
  - pr-validation
  - changed-files
---

# Athena PR Validation Lints Changed Frontend Source Files

## Problem

Athena had a changed-file lint command for Convex code, but no equivalent gate
for changed browser-facing source files. A branch could touch
`packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
and pass the normal PR path while direct ESLint still reported unused variables
or React hook dependency warnings.

That made frontend lint depend on agents remembering an ad hoc file-level
command instead of a repo-owned sensor.

## Solution

`@athena/webapp` now has `lint:frontend:changed`, backed by
`packages/athena-webapp/scripts/frontend-lint-changed.sh`. The command compares
changed `src`, `shared`, and `types.ts` files against `origin/main`, also
including local tracked and untracked worktree changes, then runs ESLint only on
changed `.ts` and `.tsx` frontend files.

The root `pr:athena` command runs `lint:frontend:changed` after the Convex
changed-file lint. The harness registry also maps changed frontend source files
to this command, and generated Athena agent docs expose the surface through the
validation map and guide.

The POS register view-model file is clean under direct ESLint, so the new gate
can be trusted for the original failure class instead of inheriting known local
lint debt.

## Prevention

- Keep `bun run --filter '@athena/webapp' lint:frontend:changed` in
  `pr:athena`.
- When adding new browser-facing source roots outside `src`, `shared`, or
  `types.ts`, update `frontend-lint-changed.sh` and the harness registry
  scenario together.
- Exclude generated files from changed-file lint at the script boundary rather
  than hiding real frontend lint failures with broad ESLint ignores.
- Use a temporary unused symbol in a changed frontend file as a negative proof
  when changing this gate: the command should fail before the probe is removed.
