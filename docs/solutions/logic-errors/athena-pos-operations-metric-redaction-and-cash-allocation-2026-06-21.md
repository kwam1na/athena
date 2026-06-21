---
title: Athena POS Operations Metric Redaction and Cash Allocation
date: 2026-06-21
category: logic-errors
module: athena-webapp
problem_type: financial_metric_boundary
component: pos-operations-metrics
symptoms:
  - "Non-manager POS and Daily Operations views could hide financial cards in the browser while public query responses still carried detailed financial analytics"
  - "Daily Operations prior-day comparisons could report no prior tender activity when legacy POS rows had only paymentMethod fallback data"
  - "Cash payment totals could confuse tendered cash with net sale allocation when cash transactions included change"
root_cause: metric_projection_mixed_visibility_and_drawer_math_boundaries
resolution_type: server_owned_metric_projection
severity: high
tags:
  - daily-operations
  - pos
  - financial-redaction
  - cash-allocation
  - metrics
---

# Athena POS Operations Metric Redaction and Cash Allocation

## Problem

Store operations metrics are used by both full admins and cashier-facing POS
operators, but those roles need different data boundaries. Hiding sales cards,
comparison labels, charts, and tender breakdowns in React is not enough if the
Convex query still returns the financial analytics. Public query responses must
match the role contract because a POS-only caller can invoke the same API
without the browser panels.

Cash metrics also have two related but different meanings. Tendered cash is
used to calculate drawer movement after subtracting change given. Payment
method totals are net sale allocation by tender method. If a cash sale records
`totalPaid` or payment rows above the sale total because the cashier gave
change, reporting the raw tendered amount as the cash payment total inflates
the tender mix and can make close summaries look inconsistent.

Legacy/backfilled POS rows add a third edge: some completed transactions keep
`payments: []` with only `paymentMethod`. Summary builders must preserve those
rows in prior-day comparisons and tender totals instead of treating the day as
having no payment activity.

## Solution

Keep role filtering and financial redaction at the server query boundary:

- Require authenticated organization membership before returning even redacted
  Daily Operations data. Do not convert failed full-admin checks into data
  access.
- Derive full-admin status server-side and pass it into the snapshot builder.
  For non-admin responses, zero or omit financial fields, omit prior-day
  financial comparisons, remove timeline messages that already contain
  formatted cash values, and avoid returning manager review evidence.
- For public POS pulse summaries, force non-admin callers to the current-day
  window and return only the operational counts the UI renders. Clear payment
  mix, top items, trend, busiest-hour analytics, sales totals, averages, and
  comparison deltas.

Centralize POS payment aggregation before sharing it across Daily Operations
and EOD close summaries:

- Normalize legacy empty-`payments` rows through `paymentMethod` fallback so
  prior-day comparison labels and tender counts still see the transaction.
- Build payment method totals as net sale allocation. Aggregate payments by
  method per transaction, then cap the cash method once against the remaining
  sale total after non-cash payments.
- Build drawer cash movement separately from payment totals. For legacy cash
  fallback rows, use `totalPaid - changeGiven`; for modern payment rows, use
  cash tendered minus `changeGiven`.

## Prevention

- Treat non-admin metric changes as API contract changes, not UI-only changes.
  Add public query tests that assert hidden analytics are absent from
  non-admin responses.
- Cover both modern `payments` rows and legacy `paymentMethod` fallback rows in
  operations metric tests.
- When cash sales include change, assert both values: net sale allocation for
  payment totals and tendered-minus-change for drawer cash movement.
- Avoid scrubbing financial values from already-rendered free-form messages;
  gate or omit those message streams for roles that should not receive cash
  details.
