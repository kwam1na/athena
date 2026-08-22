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
  - register-lifecycle
  - cloud-repair
delivery_diff_fingerprint: be3af648a60da1ad1abd9cdf56464891ac18687319f716373e7d847d42cb8a2f
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

### One authoritative close boundary for drawers (V26-1247, V26-1250)

Drawer freshness is a lifecycle question with exactly one answer per scoped
drawer (store plus terminal), and both projection and repair must ask it the
same way:

- `shared/registerSessionLifecyclePolicy.ts` derives the latest authoritative
  close boundary from lifecycle occurrence evidence (closeout records, then
  `closeoutOwnedAt`, then `closedAt`), never from document insertion order, and
  classifies a candidate register open as `fresh`, `duplicate`, `obsolete`, or
  `unsafe`. Ambiguous close evidence (a closed session with no occurrence time)
  fails closed as `unsafe`.
- `localSyncRepository.findScopedRegisterSessionLifecycle` exposes that boundary
  even when no session is currently blocking, so the blocking-session and
  no-blocker paths in `projectLocalEvents.projectRegisterOpened` share one
  decision. An obsolete or unsafe open creates a permission conflict carrying
  the disposition and reason; it never creates a register session.
- Terminal cloud repair reuses the same classifier. Settled-blocker register
  conflicts are repair candidates again; an obsolete or duplicate source event
  settles every duplicate conflict row for that event and marks the event
  rejected or projected without calling projection. Only a genuinely fresh
  replacement still takes the existing safe projection path.
- A drawer in `closing` is not a blocker for repair: every path into `closing`
  leaves close-occurrence evidence (a submitted closeout stamps
  `closeoutOwnedAt`; a reopen after rejection appends a closeout record), so
  the boundary already represents it.
- Caps do not move. Candidate reads stay at 100 per conflict type and a single
  source event settles at most 2,000 open rows per invocation. The per-event
  read is status-scoped (`by_store_terminal_localEvent_status`): only open rows
  count toward the cap, because conflict rows are never deleted and an event's
  settled history must not block its convergence; a window that is still
  truncated fails closed so an event is skipped whole rather than half-settled.
  A capped read reports `hasMoreCandidates` and stays incomplete until repair
  converges, which is the same posture this note already required for
  terminal health.

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
- Never add a second freshness rule. Any new lifecycle question about a
  register open goes through `classifyRegisterOpenAgainstLifecycleBoundary`
  with a boundary from `findScopedRegisterSessionLifecycle`.
- Repair must never replay an obsolete open to clear its conflicts; resolving
  the rows and the source event without projection is the durable path.
- Known residual risks to keep in view: an event whose raw row window exceeds
  the per-event cap is skipped permanently (no audited terminal has one); the
  query-side preview omits skipped rows whose blocker already settled while the
  repair mutation reports them; the query-side lifecycle read uses a wider
  session window than the mutation-side read; and terminal-local open times are
  compared with server-stamped cloud closes, which predates this work.

## Related

- `docs/solutions/architecture-patterns/athena-open-work-resolution-ownership-2026-07-02.md`
- `packages/athena-webapp/shared/registerSessionLifecyclePolicy.ts`
- `packages/athena-webapp/convex/pos/application/terminalRecovery/cloudRepairPolicy.ts`
- `packages/athena-webapp/convex/pos/application/terminalRecovery/resolveTerminalCloudRepair.ts`
