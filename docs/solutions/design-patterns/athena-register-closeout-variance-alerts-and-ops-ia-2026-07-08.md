---
title: Register Closeout Variance Alerts and Operations IA
date: 2026-07-08
last_updated: 2026-07-17
category: design-patterns
module: Athena operations email and dashboards
problem_type: design_pattern
component: email_processing
resolution_type: code_fix
severity: medium
delivery_diff_fingerprint: 7809923038bcc2170cfc30e966e5856e43ad3c6d7e82ce2384c122c204831e20
applies_when:
  - Adding operator reports for register closeout outcomes
  - Refining Daily Operations or Cash Controls surfaces around closeout review
  - Formatting backend-generated register closeout review reasons for operators
tags: [register-closeout, variance-alerts, operations-ia, email, cash-controls]
related_components: [convex, daily-operations, cash-controls, mailersend]
---

# Register Closeout Variance Alerts and Operations IA

## Problem

Register closeout variance work spans several surfaces: POS sync submits the
closeout, Convex decides whether a variance matters, MailerSend delivers the
operator alert, Daily Operations directs the manager to the right workflow, and
Cash Controls shows the drawer state. When each surface invents its own copy or
layout, operators see duplicated deposit history, mismatched cash totals, or
unclear review actions.

## Solution

Treat closeout reporting as one operational path with a production gate and
shared closeout facts.

- Build the email payload from the register closeout facts that operators
  review: operating date, expected cash, counted cash, net variance, register
  identity, staff attribution, notes, and review reason. Include the operating
  date in both the report header and subject so managers can triage alerts from
  multiple store days without opening each email.
- Treat review reasons as backend-generated evidence strings. If they embed a
  stored minor-unit variance, run them through the shared review-reason
  formatter with the store currency before they reach email previews, sent
  MailerSend payloads, Daily Operations, or Cash Controls UI.
- Trigger the email from the POS public sync path only after closeout projection.
  For a non-zero variance, keep the notification marker on the approval request.
  For an exact match, mark the register session with the close event ID before
  scheduling the completion report. This prevents sync retries from resending
  while allowing a later reopened-and-closed event to produce a new report.
- Gate the scheduling helper on `process.env.STAGE === "prod"` so dev, tests,
  and preview environments can render templates without sending operational
  alerts.
- Keep the email template self-previewable with dummy data so local preview
  routes can render without requiring a production payload.
- Align Daily Operations and Cash Controls to the same review facts: use the
  reviewed expected/count cash totals, danger tone for negative variances, and
  compact action rows that preserve labels and accessible names.

For dashboard IA, prefer one primary job per surface:

- Daily Operations should answer "what blocks close and where do I go?"
- Cash Controls should answer "which drawers are live, in review, or closed?"
- Deposit history should stay out of the high-level cash controls dashboard
  unless it is directly needed for the current decision.

## Why This Matters

Operator reports are production behavior, not just presentation. A closeout
email sent in the wrong environment creates noise, while a missing variance
alert can hide a cash-control exception. Keeping matched and variance outcomes
tied to the same trigger, template family, and cash facts reduces drift between
the email and the review surfaces.

The same applies to IA. Compact tiles are useful only when they keep the
decision visible. Truncating blocker copy or forcing a desktop table into a
mobile viewport makes the surface feel smaller but less operational. Mobile
closed-session previews should become cards with explicit `Opened` and `Closed`
metadata instead of squeezed table columns.

## Prevention

- Add tests at each boundary: matched and variance email rendering, payload
  construction, per-close-event sync scheduling and deduplication, daily report
  cash totals, Daily Operations actions, and Cash Controls presentation.
- Keep production-only alert gates near the scheduler, not inside the email
  template. Templates should remain previewable in local development.
- When adding cash metrics, choose a single source of truth and test a
  prod-shaped payload where summary cards and reviewed items could otherwise
  diverge.
- Add both payload-level and render-level tests for review reasons that contain
  raw stored amounts, including a non-GHS currency case, so previews and sent
  emails cannot drift back to unformatted `2000`-style values.
- Prefer the register session's resolved `closeoutOperatingDate` for variance
  alert reports, then fall back to `openedOperatingDate` or a timestamp-derived
  date only for older sessions without stored schedule evidence.
- On mobile dashboards, replace dense tables with card summaries when the data
  is preview/reference material rather than active spreadsheet work.

## Examples

Production-only alert scheduling:

```ts
export function shouldScheduleRegisterCloseoutVarianceAlerts() {
  return process.env.STAGE === "prod";
}
```

Compact mobile metadata for closed sessions:

```tsx
<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-layout-sm gap-y-1">
  <dt>Opened</dt>
  <dd>{formatTimestamp(session.openedAt)}</dd>
  <dt>Closed</dt>
  <dd>{session.closedAt ? formatTimestamp(session.closedAt) : "Not recorded"}</dd>
</dl>
```

Shared review-reason formatting:

```ts
formatStoredReviewReason(reason, (amount) =>
  currencyFormatter(storeCurrency).format(toDisplayAmount(amount)),
);
```

## Related

- `docs/solutions/logic-errors/athena-register-closeout-shared-gate-2026-07-01.md`
- `docs/solutions/logic-errors/athena-cash-controls-closeout-review-ia-2026-06-08.md`
- `docs/solutions/architecture/athena-pos-terminal-runtime-review-actions-2026-05-28.md`
