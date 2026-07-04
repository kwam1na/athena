---
title: Athena EOD Automation Manager Report Emails
date: 2026-07-04
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
---

# Athena EOD Automation Manager Report Emails

## Problem

Athena needed to send a manager-facing daily report after the EOD automation
successfully completed a store day. The report depends on the completed
`dailyClose.reportSnapshot`, live register-session cash-position corrections,
store currency formatting, and the admin-recipient list in `ADMIN_EMAILS`.

The tempting implementation is to send directly from the daily close mutation,
but email delivery is network I/O. In Convex, that belongs in an action, while
the close mutation should stay focused on durable state changes.

## Solution

Keep the close lifecycle mutation pure and add an action wrapper around the
scheduled automation entrypoint:

- `runConfiguredDailyOperationsAutomationMutation` performs the existing
  automation mutations and returns EOD auto-complete results.
- `runConfiguredDailyOperationsAutomation` is an internal action that calls the
  mutation, filters for fresh `applied` EOD auto-complete results, then sends
  manager reports.
- `sendDailyManagerReportToAdminsForDate` is an internal action that assembles
  the report payload for one completed operating date and sends it to every
  recipient in `ADMIN_EMAILS`.
- Manual and support sends stay separate through the existing explicit
  recipient actions.

The important guard is filtering only fresh action results:

```ts
function isAppliedEodAutoCompleteResult(result) {
  return result?.action === "applied" && result.run.outcome === "applied";
}
```

That excludes dry runs, disabled policies, skipped outcomes, and
`already_recorded` idempotency returns so scheduled retries do not resend old
reports.

## Why This Matters

The action wrapper keeps Convex side effects in the right runtime while still
letting the automation mutation remain deterministic and testable. It also
makes the recipient source explicit: scheduled automation sends to
`ADMIN_EMAILS`, while one-off testing actions can still target a single address.

Report payload construction should happen after completion, not before. The
completed snapshot is the source of truth for status, notes, readiness, and
operating date, while live register-session reads can correct cash position for
historical days with multiple sessions.

## Prevention

- Keep network delivery out of Convex mutations. Use an internal action wrapper
  when an automation mutation needs to trigger email, webhooks, or other
  external side effects.
- Filter notification sends by fresh `applied` automation results, not by the
  presence of any applied automation run.
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

await sendDailyManagerReportsForAppliedEodAutomationWithCtx(ctx, {
  results: result.eodAutoCompleteResults,
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
- `packages/athena-webapp/convex/constants/email.ts`
