---
title: Athena Daily Close Row Metadata Redaction
date: 2026-06-27
category: logic-errors
module: athena-webapp
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "EOD Review rows lost their rich metadata strip after broad-view redaction"
  - "Redacted sale rows exposed a transaction number but linked through a redacted subject id"
  - "Transaction summary rows could show only a register number without terminal context"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - athena-webapp
  - daily-close
  - eod-review
  - redaction
  - links
---

# Athena Daily Close Row Metadata Redaction

## Problem

Daily close items are shared across full-admin and broad operational views. When
the broad-view redaction boundary strips too much, EOD Review rows lose the
operator context that makes them useful: terminal/register labels, source links,
and compact detail metadata. When it strips too little, the same rows can leak
financial close evidence to roles that should only see operational work state.

## Symptoms

- EOD Review rows collapsed to title and helper text with no metadata strip.
- Sale rows with redacted subjects displayed a transaction number but crashed or
  navigated incorrectly when the inline link was followed.
- Register-related detail surfaces showed `Register 8` without the terminal
  context operators use elsewhere.

## What Didn't Work

- Treating `metadata` as unsafe wholesale removed the same safe fields the UI
  uses to render source context and link affordances.
- Rebuilding transaction links from `subject.id` failed for broad-view sale rows
  because the subject id is intentionally redacted.
- Fixing the visible label in React alone was insufficient because the
  transaction detail page did not receive the terminal display name from the
  query payload.

## Solution

Make the redaction boundary field-aware instead of object-wide. Preserve safe
daily-close row structure and remove only restricted financial metadata keys:

```ts
return {
  ...item,
  link: item.link,
  metadata: redactDailyCloseMetadata(item.metadata),
  subject: item.subject
    ? {
        ...item.subject,
        id: "redacted",
      }
    : item.subject,
};
```

In the EOD Review UI, prefer preserved item links for source navigation when a
redacted subject id cannot be used. Render terminal/register context as one
source affordance so the operator has a single link target for the source
workflow.

For transaction detail summaries, carry terminal display name through
`getTransactionById` and format the register row value from both fields:

```ts
if (terminal && register) {
  return `${terminal} / ${register}`;
}
```

The row label already says `Register`, so the value should stay compact:
`Codex / 8`, not `Codex / Register 8`.

## Why This Works

Daily close redaction is a projection contract, not a generic privacy filter.
The UI needs safe operational context to help staff close the day, while
restricted financial close evidence must remain unavailable in broad views.
Preserving the row link and safe metadata keeps the scanner-friendly review
surface intact without exposing cash values.

Using the preserved link also respects the redaction model. If the server says
`subject.id` is redacted, the client should not assume it can reconstruct a
route from that field. The already-projected `item.link` is the safe navigation
contract.

## Prevention

- Add broad-view snapshot tests that assert safe metadata and `item.link`
  survive while financial metadata keys are removed.
- Add component tests for redacted rows that click or inspect the inline source
  link rather than only asserting visible transaction text.
- Keep terminal/register display formatting close to the component boundary that
  owns the row label. If the label already names the field, avoid repeating that
  label inside the value.
- When adding new metadata keys to daily close items, classify them as safe
  operational context or restricted evidence in the redaction helper at the same
  time.

## Related Issues

- `docs/solutions/logic-errors/athena-operational-status-surfaces-2026-05-10.md`
- `docs/solutions/logic-errors/athena-pos-operations-metric-redaction-and-cash-allocation-2026-06-21.md`
