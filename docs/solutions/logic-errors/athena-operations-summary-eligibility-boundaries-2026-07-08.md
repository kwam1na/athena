---
title: Athena Operations Summaries Must Match Eligible Detail Rows
date: 2026-07-08
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A summary card reports reserved stock, sales, or terminal activity that the linked workspace cannot show"
  - "Filtering by a summary state opens an empty table even though the aggregate count is nonzero"
  - "Support controls need to pause terminal runtime reporting without changing local POS data"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - operations
  - pos
  - stock-adjustments
  - terminal-runtime
  - read-models
---

# Athena Operations Summaries Must Match Eligible Detail Rows

## Problem

Operational summary cards are entry points into workspaces. If a card counts
records that the destination table cannot render, operators land on an empty
detail view and lose trust in the signal. The same boundary applies to terminal
runtime controls: support can only reason about a paused heartbeat if the local
terminal reads that setting from the same cloud contract that the support page
mutates.

## Symptoms

- A stock-adjustment summary can report reserved units while the reserved filter
  shows no SKU rows.
- A POS all-time pulse can show only a capped transaction history even though
  the all-time card totals include the full store history.
- A terminal support page can expose a heartbeat switch, but the local runtime
  will continue reporting unless the POS runtime hook queries the setting.

## What Didn't Work

- Counting every stock reservation source without applying the same product
  eligibility checks as the table. Archived products should not appear in the
  operator-facing reserved summary.
- Limiting all-time POS chart buckets to a recent sample while leaving all-time
  card totals uncapped. That makes the chart and cards describe different data
  sets.
- Treating heartbeat pause as a UI-only preference. The terminal itself must
  query live runtime config and skip `reportTerminalRuntimeStatus` when paused.

## Solution

Keep aggregate read models and local runtime loops tied to the same eligibility
contract as the detail surface they drive.

- For stock adjustments, hydrate the product behind reserved SKUs and exclude
  archived products before computing the summary. When a summary filter points
  to rows beyond the first loaded page, load more eligible rows before showing
  the empty-table state.
- For POS Store pulse, do not cap all-time `transaction_dates` history when the
  selected range is all time. Sampling is useful for recent previews, but
  all-time must reflect all completed POS rows for the store.
- For terminal heartbeat controls, persist `heartbeatEnabled` on the terminal,
  expose it through the secured terminal runtime-config query, and have the
  local POS runtime hook skip the runtime-status publisher while the setting is
  disabled.

## Why This Works

The operator sees one coherent data set: the card, filter, table, and detail
rail all agree about which records are actionable. The local POS terminal also
receives support-owned runtime settings through Convex instead of relying on
stale page state or local-only toggles.

## Prevention

- When adding an operations summary, write a regression that follows the card
  filter into the table and proves at least one eligible row can render when the
  count is nonzero.
- Keep archived or otherwise hidden products out of operator action summaries
  unless the destination workspace has an explicit archived-record mode.
- Treat terminal runtime support settings as cloud configuration. Test both the
  command/query path and the local hook that consumes the setting.
- For all-time analytics, audit both cards and chart buckets for shared caps.

## Related Issues

- [Athena Stock Adjustments Should Name Checkout And POS Reservation Sources](./athena-stock-adjustments-checkout-reservations-2026-05-08.md)
- [Athena POS Register Sync Repair and Runtime Reconciliation](./athena-pos-register-sync-repair-and-runtime-reconciliation-2026-06-26.md)
- [Athena POS Terminal Recovery Readiness Boundary](../architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md)
