---
title: Athena Store-Day Auto-Start Should Preserve Blockers as Manager Review Evidence
date: 2026-06-11
category: architecture
module: athena-webapp
problem_type: store_day_auto_start_review
component: daily-operations
symptoms:
  - "POS cashiers are blocked when Opening Handoff has unresolved review work"
  - "Scheduled automation can accidentally hide blockers if it starts Opening without preserving evidence"
  - "Manual Opening acknowledgement needs to stay strict while automation keeps the store day moving"
root_cause: opening_blockers_were_modeled_as_start_preconditions_without_an_automation_review_escape_hatch
tags:
  - athena
  - daily-operations
  - pos
  - automation
  - review
resolution_type: scheduled_start_with_review_evidence
severity: high
---

# Athena Store-Day Auto-Start Should Preserve Blockers as Manager Review Evidence

## Problem

POS depends on the store day being started. If Opening Handoff blockers keep the
daily opening in `blocked` or `needs_attention`, cashier sale flow is held even
when the correct operational response is manager follow-up after opening.

Manual Opening still needs strict acknowledgement rules. The risk is only the
scheduled automation path: it must open the store day at the configured local
time without pretending blocker, carry-forward, or review evidence has been
resolved.

## Solution

Use a store-scoped automation policy for `daily_operations/opening.auto_start`:

- `openingLocalStartMinutes` stores the configured local minute of day.
- `operatingTimezoneOffsetMinutes` determines the local operating date and
  prevents the cron from recording a run before the configured local time.
- `openingBlockerHandling` controls whether blockers are skipped or routed to
  manager review.

When the policy allows manager review, the automation path may start Opening
with blockers, review items, and carry-forward items. Those items are copied
onto the `dailyOpening` record as `managerReviewEvidence` and mirrored into the
operational event metadata. The manual `startStoreDay` mutation does not accept
that bypass and continues to require blocker resolution and acknowledgement.

## Implementation Notes

- Keep the persisted field domain-named (`managerReviewEvidence`) and hydrate
  UI snapshots as `reviewEvidence` for component readability.
- Show the evidence after the store day is started so managers still have a
  clear review surface while POS is unblocked.
- Configure the policy from POS settings with full-admin access only. Cashiers
  should experience the resulting open store day, not configure the exception
  rule.
- Avoid recording skipped cron runs before the configured local start time; early
  checks are scheduler noise, not business decisions.

## Prevention

- Keep manual Opening mutations strict. The automation-specific bypass should
  require `actorType: "automation"` and the manager-review handling policy.
- Store blocker evidence on the resulting `dailyOpening` record before POS
  depends on that record as proof the store day has started.
- Treat early cron checks as no-ops. Do not record skipped automation runs before
  the configured local start time because those rows obscure the real schedule
  decision.
- Keep policy configuration behind full-admin access in POS settings. Cashier
  flow should only benefit from the open store day.

## Validation

Focused coverage should prove:

- Policy defaults are conservative until configured.
- Configured local start time gates cron execution.
- Automation can start Opening with review evidence only when policy handling is
  `manager_review`.
- Manual Opening remains strict.
- POS settings hides configuration from non-full-admin users and saves the
  configured local time plus review handling.
- Daily Opening and Daily Operations render the manager-review evidence after an
  automated start.
