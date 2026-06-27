---
title: Athena Register Closeout Review Targeting and Money Inputs
date: 2026-06-27
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: cash-controls
symptoms:
  - "A register closeout variance review was visible on the session page but applying it returned already resolved"
  - "Production sessions with large sync-review backlogs could hide the target review from action paths"
  - "Closeout counted cash could change by cents while the operator was editing the field"
root_cause: capped_store_wide_review_queries_and_browser_number_step_controls
resolution_type: code_fix
severity: high
tags:
  - cash-controls
  - local-sync
  - register-closeout
  - money-inputs
  - convex
---

# Athena Register Closeout Review Targeting and Money Inputs

## Problem

Cash Controls register sessions can have local-sync closeout reviews that are
specific to one register session. Production stores can also accumulate a large
store-wide backlog of open sync conflicts. If the page read model fetches a
targeted session review but the mutation action path only scans the capped
store-wide backlog, operators can see a review and then receive an
`already_resolved` response when they try to apply it.

The same closeout surface also accepted counted cash through an HTML
`type="number"` input with a `0.01` step. While that input is focused, browser
wheel or trackpad events can decrement the value by one cent per tick. An
operator-entered `30` can become `29.97` after three wheel ticks without any
application code explicitly changing the value.

## Solution

Treat register-session sync review lookup as session-targeted on both read and
write paths:

- Accept a `registerSessionIds` option in the shared sync-review listing helper.
- For each target session, resolve its local register-session mappings through
  `posLocalSyncMapping.by_store_terminal_cloud`.
- Query conflicts through the session-scoped
  `posLocalSyncConflict.by_store_terminal_register` index and merge those rows
  with the capped store-wide fallback.
- Use the same targeted option when rendering a register-session snapshot and
  when resolving the selected review conflicts.

Treat editable money fields as decimal text inputs, not browser number controls:

```tsx
<Input
  inputMode="decimal"
  pattern="[0-9]*[.]?[0-9]*"
  type="text"
/>
```

Keep persistence unchanged by parsing the text value through
`parseDisplayAmountInput` at submit time. This preserves the minor-unit storage
contract while avoiding browser wheel-step mutations.

## Prevention

- Any session-detail action that uses review IDs rendered by the session-detail
  read model should load a targeted session evidence set before filtering by
  those IDs. Do not rely on capped store-wide scans for actionability.
- Regression tests should seed enough older store-wide conflicts to exceed the
  cap, then place the target register-session conflict just outside the cap.
  Cover both rendering and actioning the review.
- Money inputs that persist minor units should use decimal text entry plus the
  shared parser. Avoid `type="number"` for cash entry unless wheel/step behavior
  is explicitly suppressed and tested.
- Existing POS drawer closeout controls already use this decimal text pattern;
  cash-controls register detail should stay aligned with that pattern.
