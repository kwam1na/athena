---
title: Athena POS Store Hours Settings Should Present Derived Times As Operator Context
date: 2026-06-29
category: architecture
module: athena-webapp
problem_type: pos_store_hours_settings_polish
component: pos
symptoms:
  - "Store Hours settings can show raw 24-hour schedule values beside 12-hour select inputs"
  - "Automation settings can expose offsets without the projected run time"
  - "Full-width setting cards make compact POS controls harder to scan"
  - "POS recovery failures can imply a bad code when the account lacks POS-only access"
root_cause: schedule_configuration_rendered_raw_policy_values_instead_of_operator_ready_context
resolution_type: schedule_context_presentation
severity: medium
tags:
  - pos
  - store-hours
  - automation
  - settings
  - recovery
---

# Athena POS Store Hours Settings Should Present Derived Times As Operator Context

## Problem

Store Hours and POS automation settings are policy surfaces, but operators read
them as immediate work instructions. Raw `HH:mm` values, full-row controls, and
generic recovery errors make the page look technically correct while still
leaving the next operational action ambiguous.

The risk is highest around derived scheduling. A configured opening time, an
automation offset, and the current local store time are different facts. If the
UI presents only the source value, the operator cannot tell when Athena will
actually act.

## Solution

Keep the policy values structured, then format derived scheduling context at the
edge of the UI:

- Use shared select and calendar controls for scheduling inputs so Store Hours
  follows the repository's form interaction patterns.
- Format local store times as operator-facing 12-hour labels when they appear in
  summaries, automation descriptions, and POS timing callouts.
- Derive Store Hours summary rows from current local context. If the store is
  closed now, show today's closed state before the next open and next close. If
  the store is currently operating, show today's opening context before the next
  close and following open.
- Pair automation offsets with both the source store-hours time and the
  projected run time, for example opening at `09:00 AM` and running at
  `08:00 AM`.
- Let compact setting cards fit their content inside the larger settings grid
  with `w-fit max-w-full justify-self-start` so single-purpose controls do not
  read as full-width panels.
- Keep POS recovery errors access-aware. When POS-only authorization can be the
  problem, the message should mention admin access confirmation instead of only
  asking the cashier to re-enter the code.

## Implementation Notes

The scheduling helpers should stay local and deterministic. They can operate on
minute-of-day values and store-local dates without changing persisted policy
shape.

For responsive layout, content-fit controls should still keep `max-w-full` so
long copy wraps rather than overflowing narrow viewports. Use full-width bands
only where the content is intentionally a section-wide status or save boundary.

## Prevention

- Do not render persisted `HH:mm` schedule values directly in operator-facing
  POS settings copy. Route them through the same local-time formatter used by
  the related controls.
- When adding a new automation offset, show the source time and projected run
  time together so review does not require mental arithmetic.
- Prefer repository form primitives for scheduling inputs before introducing
  native browser fields on Store Hours or POS automation surfaces.
- Keep compact setting rows content-sized unless the control is intentionally a
  full-width status band or repeated card grid.
- Normalize recovery and access failures before display so cashier-facing copy
  names the next operational check instead of repeating provider wording.

## Validation

Focused coverage should prove:

- Store Hours selects and date exceptions keep the existing save payload shape.
- Summary rows format times consistently and change order based on current
  store-local operating state.
- Store-day auto-start and EOD completion labels include projected run times.
- POS recovery copy handles POS-only access failures without leaking backend
  wording.
- Settings controls remain reachable and content-fit without breaking form
  submission.
