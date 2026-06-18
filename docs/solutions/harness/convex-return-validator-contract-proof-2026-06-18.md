---
title: Convex Public Return Validators Need Executable Contract Proof
date: 2026-06-18
category: harness
module: athena-webapp
problem_type: convex_return_validator_contract_drift
component: convex
resolution_type: exported_return_validator_contract_test
severity: high
tags:
  - convex
  - harness
  - public-contracts
  - regression-tests
---

# Convex Public Return Validators Need Executable Contract Proof

## Problem

Public Convex functions can compile and pass string-based validator checks while
still returning fields that their exported `returns` validators reject at
runtime. This is most likely when a presenter or response shape grows nested
fields and the nearby validator is updated manually in a different place.

The failure class is not tied to any one product surface. Any public Convex
query, mutation, or action with an explicit `returns` validator can drift from
the values its handler or presenter actually returns.

## Solution

Use executable return-contract proof for changed public Convex functions:

- Build representative return values from the handler or presenter boundary.
- Pass those values through `assertConformsToExportedReturns`.
- Keep the test near the changed Convex module so inferential review can connect
  the public function change to its proof.
- Preserve existing string-shape assertions only as supplemental snapshots, not
  as the production contract proof.

`assertConformsToExportedReturns` parses the function's exported Convex return
validator and validates the representative value recursively, including nested
objects, unions, arrays, records, required fields, optional fields, and
unexpected object keys.

## Prevention

- When a public Convex function with `returns` changes, update a sibling
  `.test.ts` file with `assertConformsToExportedReturns` coverage in the same
  directory.
- Do not rely on `exportReturns()` substring or JSON string assertions to prove
  returned values are accepted by Convex.
- Keep representative values realistic enough to include nested optional
  sections that are commonly returned in production.
- Let `bun run harness:inferential-review` fail closed when changed public
  Convex return validators have no executable proof.
