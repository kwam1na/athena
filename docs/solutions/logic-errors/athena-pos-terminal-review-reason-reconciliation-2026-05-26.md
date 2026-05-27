---
title: Athena POS Terminal Review Reasons And Local Settlement
date: 2026-05-26
category: logic-errors
module: athena-webapp
problem_type: terminal_runtime_review_reason_gap
component: pos-terminal-health
symptoms:
  - "Terminal health can show Needs review while terminal detail shows no unresolved cloud conflicts"
  - "A resolved server-side sync review can leave the browser terminal carrying a local review counter"
  - "Support surfaces can blur local runtime review, cloud sync evidence, and manager-owned register review"
root_cause: runtime_review_counter_was_not_explained_or_reconciled_with_cloud_settlement
resolution_type: reasoned_terminal_health_and_review_retry
severity: medium
tags:
  - pos
  - terminal-health
  - local-sync
  - cash-controls
  - diagnostics
---

# Athena POS Terminal Review Reasons And Local Settlement

## Problem

Terminal health combines two evidence classes: the browser runtime check-in and
cloud sync records. A terminal can truthfully report `needs_review` because its
local event log still has a `needs_review` item even when cloud conflicts are
resolved or absent. If terminal detail only shows cloud conflict evidence, the
badge looks unsupported and operators cannot tell whether the issue is local
runtime review, held/rejected cloud sync evidence, stale telemetry, or pending
sync.

The lifecycle gap is separate but related. Once a browser marks an uploaded
local event as `needs_review`, that event stops being a normal upload
candidate. If Cash Controls later approves the source sync event and the server
patches it to `projected`, the terminal needs a safe way to learn that durable
settlement and mark the local source event synced.

## Solution

Expose terminal health reasons from the backend and keep them presentation-safe:

- `convex/pos/application/queries/terminals.ts` should return
  `attentionReasons` from the same evidence used to derive terminal health.
- Local runtime review reasons must be distinct from cloud conflict, held, and
  rejected evidence.
- Reasons can include counts, sequence/timestamp context, and source labels, but
  must not include raw local payloads, sync secrets, staff proof tokens, PIN
  material, customer data, payment data, or raw browser fingerprints.
- Frontend terminal list/detail surfaces should render backend reasons as the
  single source of explanatory text. Older responses can still classify basic
  status from runtime fields, but they should not re-derive reason objects.

Reconcile local review settlement by manually retrying only uploaded local
review events:

- A local event with `sync.status: needs_review` and `sync.uploaded: true` can
  be sent back through the sync mutation to ask the server for the durable
  source status.
- If the duplicate source event is now `projected`, the runtime can mark the
  local source event synced and clear the terminal review count.
- If the server still returns `conflicted` or `rejected`, the local event stays
  in review and terminal health continues to explain why.
- Foreground polling and event-appended drains should not automatically requeue
  uploaded review events, or unresolved server review states can loop forever.
- Do not clear local review merely because a conflict row was resolved. The
  source `posLocalSyncEvent` status is the settlement signal.

## Boundaries

Terminal health is support telemetry. It explains why a terminal needs
attention, but it does not approve closeouts, reject register activity, or create
new manager-review workflows. Cash Controls and Operations continue to own
register-session review and reconciliation actions.

## Regression Targets

- `convex/pos/application/terminals.test.ts` should prove runtime review count
  plus clear cloud conflicts returns `needs_attention` with a local runtime
  reason.
- `convex/pos/public/terminals.test.ts` should prove public validators include
  reason fields without unsafe payloads or secrets.
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts` should prove
  uploaded review events retry and clear locally only when the server source
  event is projected.
- `POSTerminalDetailView.test.tsx`, `POSTerminalHealthView.test.tsx`, and
  `terminalHealthPresentation.test.ts` should prove list/detail copy uses the
  same backend reason model.

## Prevention

- Do not derive terminal detail explanations solely from cloud conflict counts.
- Do not label stale telemetry or pending sync as manager-review work.
- Do not add another approval surface to terminal health.
- Keep the POS terminal health validation-map scenario current when reason,
  runtime, register diagnostics, or Cash Controls evidence surfaces change.
