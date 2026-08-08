---
title: Expose operational state consistently across catalog, POS, and EOD alerts
date: 2026-08-08
category: design-patterns
module: athena-webapp operational workspaces
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "An archived catalog item appears in a search result or report detail"
  - "A POS-only session needs a different launcher order from a manager session"
  - "An EOD notification identifies an open register session"
tags: [operational-state, archived-products, pos, eod-email, catalog]
related_components: [reports, products, procurement, quick-add, daily-close]
delivery_diff_fingerprint: 2ee48ae435000623a1bbd6857481905761ea6659fb97e2dad295cbdaa5e75eb2
---

# Expose operational state consistently across catalog, POS, and EOD alerts

## Problem

Operator surfaces had the data needed to explain exceptional state, but did not
always present it where a decision was made. Archived products could look live
in search results, POS-only users saw launchers in a less useful order, and the
EOD alert named an open register session without identifying its terminal or
register.

## Solution

Carry the existing operational context to the boundary that renders the
operator-facing message.

- Search-result rows use an archived badge and a low-emphasis row treatment;
  report SKU details receive the catalog availability in their identity payload.
- The POS launcher list changes order only when financial-detail access is
  absent, leaving the manager layout unchanged.
- The email adapter reads the already-projected `terminal` and `register`
  metadata for register-session blockers and prefixes the normal next action:

```ts
const location = [terminal, register].filter(Boolean).join(" · ");
return location ? `${location}. ${item.message}` : item.message;
```

## Why This Matters

Keeping the workflow state and its human context together lets operators act
without opening another page or inferring why a row is visually different. The
underlying status, authorization, and closeout behavior remain unchanged.

## Prevention

- When adding an operational-state presentation, test both the state-specific
  rendering and the unchanged default behavior.
- Prefer existing report-item metadata over a new query when the notification
  already has the required terminal or register context.

## Examples

- An archived product result keeps its normal selection behavior but dims its
  labels and carries an explicit Archived badge.
- An EOD blocker reads `Front Counter · Register 3. Close the register
  session before completing the end of day review.`

## Related

- [Register Closeout Variance Alerts and Operations IA](register-closeout-variance-alerts-and-operations-ia-2026-07-08.md)
