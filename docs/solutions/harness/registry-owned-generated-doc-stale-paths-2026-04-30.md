---
title: Registry-Owned Harness Paths Need Source Diagnostics
date: 2026-04-30
category: harness
module: repo-harness
problem_type: stale_generator_source
component: harness-review
symptoms:
  - "pre-push auto-runs harness:generate but still blocks on missing generated validation-map paths"
  - "Generated harness docs reference routes or components that were removed from the app"
root_cause: stale_harness_app_registry_entry
resolution_type: diagnostic_improvement
severity: medium
tags:
  - harness
  - generated-docs
  - validation-map
  - pre-push
---

# Registry-Owned Harness Paths Need Source Diagnostics

## Problem

Some harness drift is safe to repair by regenerating docs. Stale validation-map paths are different: the generated file can be fresh while its source entry in `scripts/harness-app-registry.ts` still points at a deleted route or component.

In that case, rerunning `bun run harness:generate` only reproduces the stale reference.

## Solution

Keep generated-doc auto-repair for missing or stale generated artifacts, but classify missing validation-map path prefixes as registry-source drift. The diagnostic should name the generated file, the missing path, and `scripts/harness-app-registry.ts` as the source to update before rerunning generation.

## Prevention

- When removing app surfaces, search `scripts/harness-app-registry.ts` for the path or parent validation scenario.
- Treat generated docs as outputs; update registry scenarios before regenerating them.
- Do not auto-delete registry entries unless the tool can prove the validation intent should disappear.
