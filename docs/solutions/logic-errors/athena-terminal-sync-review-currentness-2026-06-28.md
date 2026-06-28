---
title: Athena Terminal Sync Review Currentness
date: 2026-06-28
category: logic-errors
module: athena-webapp
problem_type: stale_review_evidence
component: pos-terminal-health
symptoms:
  - "Terminal health reported local or cloud review counts that no longer matched the current review workspaces"
  - "Closed register-session conflicts kept surfacing as manager review after the drawer state had already resolved them"
  - "Cash-control review groups lost their register-session target and fell back to generic manager-review messaging"
root_cause: terminal_review_summaries_counted_raw_sync_conflicts_without_current_work_state
resolution_type: current_state_review_projection
severity: high
tags:
  - terminal-health
  - local-sync
  - register-session
  - cash-controls
  - open-work
---

# Athena Terminal Sync Review Currentness

## Problem

Terminal support surfaces can receive large histories of `needs_review` sync
conflicts. Some conflicts are still actionable, but others are only historical
evidence from register sessions that have already closed cleanly or from
inventory review work that has already moved into Operations open work.

Counting raw conflict rows makes terminal health look worse than the actual
work queue. It also creates misleading actions: a terminal can say manager
review is required when the only current work is a cash-control register-session
review, or it can link to open work while showing a count that includes stale
closed-session conflicts.

## Solution

Build terminal review summaries from current work state, not from raw sync
conflict volume alone:

- Resolve register-session conflicts through a shared repository helper before
  counting them. Prefer an explicit `blockingRegisterSessionId`, then fall back
  to the local sync mapping or normalized cloud register-session id. Only
  blocking register-session statuses remain actionable.
- Keep cash-control action targets on the review summary group and promote them
  into terminal health reasons as `cash_control_register_session` targets. Do
  not reconstruct a cash-control target from reason type once a repository
  `reviewSummary` exists; the per-group summary is the authoritative source.
- Resolve inventory review conflicts through open Operations work when a target
  exists. If lookup is capped before a target can be proven absent, surface the
  summary as incomplete instead of pretending the terminal is clean.
- Bound conflict reads to the amount the terminal support surface can present or
  safely repair. If the bounded read overflows, set
  `targetResolutionIncomplete` and keep the terminal in a review-backlog state.
- Use the same currentness resolver for terminal evidence and support repair
  previews so repair actions do not reintroduce conflicts that terminal health
  already classified as settled.

## Prevention

- Any terminal health count must answer "what work is still actionable now?"
  before it becomes operator copy.
- Never group all cloud sync conflicts by reason type and then apply a
  type-level fallback action target. Mixed manual, open-work, and cash-control
  groups can share the same `cloud_conflict` reason type.
- Add regression coverage whenever a sampled review summary includes more stale
  closed-session conflicts than the source cap, plus at least one still-current
  inventory or cash-control item.
- Treat capped evidence as diagnostic risk. A capped summary may be incomplete,
  but it must not report healthy or clear unless the current work target has
  actually been resolved.
