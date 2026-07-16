---
title: Athena EOD Automation Manager Report Emails
date: 2026-07-04
last_updated: 2026-07-16
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: email_processing
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Convex automation completes an operational workflow and must notify managers"
  - "Email delivery needs data assembled from the completed workflow record"
tags:
  - eod-automation
  - manager-reports
  - mailersend
  - convex-actions
  - daily-close
delivery_diff_fingerprint: 0f3e6994d617f1b1a3a772ecfb438053d25592b79bb8dd8e68c23c750d702f7c
---

# Athena EOD Automation Manager Report Emails

## Problem

Athena needs to tell managers both when EOD automation completes a store day
and when it leaves the day open for manual close. Completed reports depend on
the completed `dailyClose.reportSnapshot`, while prepared, skipped, and failed
reports are assembled from the live EOD Review snapshot. These paths use live
register-session cash-position corrections, store currency formatting, and the
admin-recipient list in `ADMIN_EMAILS`.

The tempting implementation is to send directly from the daily close mutation,
but email delivery is network I/O. In Convex, that belongs in an action, while
the close mutation should stay focused on durable state changes.

## Solution

Keep the close lifecycle mutation pure and add an action wrapper around the
scheduled automation entrypoint:

- `runConfiguredDailyOperationsAutomationMutation` performs the existing
  automation mutations and returns EOD auto-complete results.
- `runConfiguredDailyOperationsAutomation` is an internal action that calls the
  mutation, filters for fresh reportable EOD auto-complete results, then sends
  manager reports.
- `sendDailyManagerReportToAdminsForDate` is an internal action that assembles
  the report payload for one completed operating date and sends it to every
  recipient in `ADMIN_EMAILS`.
- `automationNotificationDelivery` reserves one action-required delivery per
  store, operating date, notification kind, and normalized recipient email.
  Sent reservations are terminal; failed or expired reservations can retry.
- Manual and support sends stay separate through the existing explicit
  recipient actions.

The important guard follows an explicit outcome policy: notify for every failed
run and every skipped run unless decision evidence classifies it as already
completed. The router does not independently query close state.

```ts
if (result.run.outcome === "skipped") {
  return result.run.decisionEvidence?.classification === "completed"
    ? null
    : "skipped";
}
```

This includes fresh completed and prepared reports plus every skipped or failed
run covered by the manual-close policy. Dry runs, disabled policies, and
already-completed outcomes remain silent. Per-recipient delivery
reservations prevent scheduled retries from resending a successful alert while
still allowing provider failures to retry.

## Why This Matters

The action wrapper keeps Convex side effects in the right runtime while still
letting the automation mutation remain deterministic and testable. It also
makes the recipient source explicit: scheduled automation sends to
`ADMIN_EMAILS`, while one-off testing actions can still target a single address.

Report payload construction should happen from the state that owns the message.
Completed reports should use the completed snapshot as the source of truth for
status, notes, readiness, and operating date. Prepared reports should use the
live EOD Review snapshot and link managers back to EOD Review as the CTA. Live
register-session reads can correct cash position for historical days with
multiple sessions in both paths.

Outcome patches must also omit optional fields rather than explicitly passing
`undefined`. Convex strips `undefined` values before validation, so patching a
required field such as `eventIds` with `undefined` can remove the required
field. Preserve the existing ledger value unless a concrete replacement exists.

## Prevention

- Keep network delivery out of Convex mutations. Use an internal action wrapper
  when an automation mutation needs to trigger email, webhooks, or other
  external side effects.
- Route notification sends from the recorded outcome and classification. A
  failed run and any skipped run not classified `completed` require
  manual-close guidance.
- Reserve action-required delivery per recipient before calling the provider,
  mark successful sends terminal, and make failed or expired reservations
  retryable.
- When patching Convex documents, spread optional fields only when they are
  defined so required ledger evidence cannot be stripped accidentally.
- Preserve explicit manual-send actions for development or support workflows so
  scheduled manager notifications do not reuse ad hoc recipient arguments.
- Add tests at both seams: one for the automation action filter and one for the
  admin-recipient sender.
- Use completed EOD snapshots for report content and keep date-specific payload
  queries scoped to active completed closes.

## Examples

Scheduled automation should call the action entrypoint:

```ts
internal.operations.dailyOperationsAutomation.runConfiguredDailyOperationsAutomation
```

The action should call the mutation first, then send reports:

```ts
const result = await ctx.runMutation(
  internal.operations.dailyOperationsAutomation
    .runConfiguredDailyOperationsAutomationMutation,
  {},
);

await sendDailyManagerReportsForEodAutomationWithCtx(ctx, {
  results: result.eodAutoCompleteResults,
});
```

An optional outcome field should only be included when present:

```ts
await ctx.db.patch("automationRun", runId, {
  ...(args.eventIds === undefined ? {} : { eventIds: args.eventIds }),
  outcome: args.outcome,
});
```

The report sender should read recipients from codebase constants:

```ts
for (const recipient of ADMIN_EMAILS) {
  await sendDailyManagerReportEmail({
    ...report,
    recipientEmail: recipient.email,
    recipientName: recipient.name,
  });
}
```

## Related

- `packages/athena-webapp/convex/operations/dailyOperationsAutomation.ts`
- `packages/athena-webapp/convex/operations/dailyManagerReportEmail.ts`
- `packages/athena-webapp/convex/automation/runLedger.ts`
- `packages/athena-webapp/convex/schemas/automation.ts`
- `packages/athena-webapp/convex/constants/email.ts`
