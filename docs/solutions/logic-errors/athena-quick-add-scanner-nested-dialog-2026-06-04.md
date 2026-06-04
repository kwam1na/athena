---
title: Quick-Add Barcode Scanners Must Stay Inside the Product Dialog Boundary
date: 2026-06-04
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: quick-add-product-dialog
symptoms:
  - "Quick-add barcode fields needed the same scanner affordance across POS, stock adjustments, and catalog recovery flows."
  - "Closing a nested scanner overlay could also dismiss the parent quick-add dialog."
  - "Scanner controls mounted above a Radix dialog could become visually present but not clickable."
root_cause: nested_dialog_boundary
resolution_type: code_fix
severity: medium
tags:
  - quick-add
  - barcode-scanner
  - radix-dialog
  - stock-adjustments
  - pos
---

# Quick-Add Barcode Scanners Must Stay Inside the Product Dialog Boundary

## Problem

Quick add is shared by POS, stock adjustments, and catalog/product recovery
flows. Adding a scanner trigger to only one caller creates inconsistent recovery
behavior, but adding a scanner overlay beside the shared quick-add dialog can
conflict with the parent Radix dialog's outside-interaction handling.

## Symptoms

- The stock adjustment quick-add barcode field lacked the camera scan affordance
  that operators already expect from barcode search.
- Moving the affordance into the shared quick-add dialog made it available to
  every quick-add caller, but the scanner overlay initially inherited the
  parent modal's pointer-event lock.
- Closing the scanner overlay could be interpreted as an outside interaction on
  the parent quick-add dialog, dismissing both dialogs.

## Solution

Keep the barcode scanner owned by `QuickAddProductDialog`, and make the nested
modal relationship explicit:

- Render a scanner icon button inside the shared barcode input so all quick-add
  callers get the same affordance.
- Decode camera results through the shared quick-add state and normalize the
  scanned barcode before writing it into `quickAddLookupCode`.
- Give the scanner overlay explicit pointer-event access because it is portaled
  above a modalized Radix dialog.
- While the scanner is open, prevent the parent quick-add `DialogContent` from
  handling pointer, interact-outside, or escape events as parent-dismiss events.

## Why This Works

The quick-add dialog owns the barcode field state, validation, submit payload,
and existing-SKU barcode recovery path. Keeping scanner state in the same
component avoids caller-specific plumbing and makes the affordance available
wherever quick add is used. Blocking parent outside-dismiss only while the
scanner is open preserves normal quick-add close behavior the rest of the time.

## Prevention

- Put shared quick-add controls in `QuickAddProductDialog`, not in individual
  callers, unless the behavior is truly caller-specific.
- When nesting a custom overlay above a Radix dialog, test both the child close
  path and the parent remaining open.
- Add focused tests that assert scanner decode fills the field and scanner close
  does not call the parent `onOpenChange(false)`.
