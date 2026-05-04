---
title: Athena Cycle Counts Need Durable Drafts Before Inventory Mutation
date: 2026-05-04
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: stock-ops
symptoms:
  - "Cycle count inputs reset when the stock adjustment workspace remounted"
  - "Inventory snapshot refetches could replace operator-entered counts with current system counts"
  - "Operators could lose in-progress physical counts before submitting a stock adjustment batch"
root_cause: local_component_state_used_as_operational_draft
resolution_type: code_fix
severity: high
tags:
  - stock-ops
  - cycle-count
  - drafts
  - operational-events
  - inventory
---

# Athena Cycle Counts Need Durable Drafts Before Inventory Mutation

## Problem

Cycle counts are operational work in progress. The operator may count a shelf,
leave the workspace, refresh the browser, or return after inventory has changed.
Local React state is not durable enough for that workflow because it is tied to a
mounted component and the latest inventory snapshot.

## Solution

Split the workflow into three ownership boundaries:

- URL search state owns navigation context: mode, selected scope, active SKU,
  page, search query, and filters.
- Convex cycle-count drafts own work-in-progress counted quantities, line
  baselines, saved state, discard state, and stale-baseline checks.
- Stock adjustment batches own the final inventory mutation, approval request,
  inventory movement records, and submitted batch audit.

This keeps the stock adjustment batch as the only final inventory write path
while making the pre-submit count resilient to remounts and route changes.

## Baselines

Capture `baselineInventoryCount` and `baselineAvailableCount` on the draft line
when the operator first saves a count for that SKU. On submit, compare those
baselines with the current SKU counts before creating a stock adjustment batch.
If they differ, block submission with a review state and leave inventory
untouched.

## Prevention

- Do not store operator-entered counts in the URL.
- Do not let inventory snapshot refetches overwrite saved draft values.
- Do not write `inventoryMovement` records from draft saves or discards.
- Keep manual stock adjustments out of the cycle-count draft model until a
  separate plan intentionally broadens the draft workflow.
- Add command tests for draft reuse, cross-store SKU rejection, stale-baseline
  blocking, discard, and submit delegation whenever the draft API changes.

## Related Issues

- Linear: V26-457, V26-458, V26-459, V26-460, V26-461, V26-462.
