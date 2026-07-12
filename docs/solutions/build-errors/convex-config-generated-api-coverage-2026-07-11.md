---
title: Exclude Convex configuration modules from generated API coverage
date: 2026-07-11
category: build-errors
module: Convex generated artifact validation
problem_type: build_error
component: development_workflow
symptoms:
  - "pr:athena reports convex.config as missing after convex dev --once succeeds"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [convex, generated-api, pre-commit, delivery-gate]
delivery_diff_fingerprint: 576208b9c1ac742c87f712cca457121b076ee85e55963a0ee43cf7659f351aa9
---

# Exclude Convex configuration modules from generated API coverage

## Problem

Athena's generated-artifact gate compares every Convex TypeScript source module with the imports emitted in `convex/_generated/api.d.ts`. After `convex/convex.config.ts` was introduced, `bun run pr:athena` remained blocked even after a successful `bunx convex dev --once` refresh.

## Symptoms

- The gate reports `Convex generated API is missing module references: convex.config`.
- `bunx convex dev --once` completes successfully but does not add `convex.config` to `_generated/api.d.ts`.

## What Didn't Work

- Re-running Convex generation cannot fix the mismatch. `convex.config.ts` configures the Convex app; it is not a callable function module and Convex deliberately omits it from the generated API surface.

## Solution

Keep generated API coverage strict for callable source modules, while explicitly excluding framework-owned configuration modules:

```ts
const CONVEX_API_MODULE_EXCEPTIONS = new Set([
  "auth.config",
  "convex.config",
  "schema",
  "storeFront/customer",
]);
```

The generated-artifact test fixture includes a representative `convex.config.ts` alongside a callable module. Default verification must ignore the config file and still require the callable module's generated import.

## Why This Works

The validator's source set now matches Convex's actual code-generation contract. Configuration and schema files are not public or internal function modules, while ordinary query, mutation, and action modules remain covered by the missing-reference gate.

## Prevention

- Add framework configuration files to the explicit exception set only after confirming a real Convex refresh never emits them.
- Keep a callable source module in the same fixture so broad exclusions cannot make generated API verification vacuous.
- When the gate names a missing module, distinguish generation drift from a non-callable framework file before repeatedly contacting a development deployment.

## Related Issues

- `scripts/pre-commit-generated-artifacts.ts`
- `scripts/pre-commit-generated-artifacts.test.ts`
