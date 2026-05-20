---
title: Athena POS Terminal Health Visibility Keeps Telemetry Out Of Review Work
date: 2026-05-20
category: architecture
module: athena-webapp
problem_type: pos_terminal_health_visibility
component: pos
symptoms:
  - "Cash Controls needs enough terminal context to support register sessions"
  - "Stale or pending terminal check-ins can look like reconciliation work"
  - "Support evidence must not expose terminal sync secrets or staff proof tokens"
root_cause: terminal_health_telemetry_and_register_reconciliation_shared_operator_surfaces
resolution_type: terminal_evidence_boundary
severity: medium
tags:
  - pos
  - terminal-health
  - cash-controls
  - diagnostics
  - local-first
---

# Athena POS Terminal Health Visibility Keeps Telemetry Out Of Review Work

## Problem

POS terminal health now appears near cashier and cash-controls workflows. That is
useful for support because a register session needs terminal, sync, and trace
context, but it is risky if stale check-ins are presented as manager-review work.

The important distinction is ownership. Terminal health describes whether a
browser terminal has recently reported operational telemetry. Local POS events
describe cashier-authorized register activity. Cash Controls can use terminal
context as evidence, but it should not create variance or reconciliation work
from stale telemetry alone.

## Boundaries

- Terminal check-ins are telemetry. They can show fresh, stale, pending, or
  unavailable runtime status, but they do not prove the drawer is wrong.
- Local POS events remain cashier authority. Register open, sale, closeout, and
  reopen events are still the durable source for cash-control projection.
- Unresolved local sync conflicts remain the source of needs-review copy. Cash
  Controls should show manager-review language only when sync conflict records,
  variance approvals, or closeout approvals require it.
- POS Settings owns terminal setup. Registration, register number assignment,
  local seed provisioning, and terminal setup repair belong there rather than in
  Cash Controls.
- Cash Controls owns register-session review. It can link to support evidence
  and traces, but it should not mutate terminal setup or resolve terminal
  check-in state.

## Solution

Add terminal health as a support visibility layer with separate write, read, and
presentation boundaries:

- Store only the latest redacted runtime status for each active POS terminal.
  Authorize check-ins with store membership, terminal ownership, active terminal
  state, and the terminal sync secret, then persist counters, timestamps,
  readiness labels, and safe failure text.
- Publish check-ins from the browser POS runtime on a best-effort path. Failed
  check-ins remain diagnostic evidence and must not block cashier commands,
  staff sign-in, local event append, sync upload, or closeout.
- Render Terminal Health as a POS operations console and terminal detail route.
  Keep POS Settings focused on current-device setup and link from settings to
  the health console for support review.
- Link Cash Controls and register diagnostics to terminal detail/support
  evidence without treating stale telemetry as reconciliation work. Existing
  POS local sync conflict records continue to own needs-review copy.
- Keep harness coverage tied to the whole surface: terminal schema/public
  checks, browser runtime publisher tests, POS Settings, terminal health/detail
  views, register diagnostics, and cash-controls evidence presentation.

## Redaction

Support evidence can show terminal display name, register number, session code,
sync status, and trace links. It must not expose terminal sync secrets, secret
hashes, staff proof tokens, local IndexedDB payload bodies, PIN material, or raw
browser fingerprints.

Convex terminal public returns should continue stripping sync-secret data, and
browser diagnostics should keep proof/token fields reduced to presence,
sequence, status, and timing labels.

## Validation

When this boundary changes, cover all four surfaces together:

- Terminal runtime status and browser publisher/readout.
- POS Settings terminal setup and detail behavior.
- POS register support diagnostics.
- Cash Controls dashboard/detail evidence and needs-review copy.

The validation-map scenario for POS terminal health should include terminal
schema/public tests, POS Settings tests, runtime sync tests, sync-status
presentation tests, POS register diagnostics tests, and cash-controls dashboard
and register-detail tests.

## Prevention

- Map stale or pending terminal-health statuses to pending sync or telemetry
  copy, not needs-review copy.
- Keep explicit conflict statuses such as `conflict`, `conflicted`, and
  `review` mapped to manager-review presentation.
- Link support evidence from Cash Controls detail pages without adding a new
  terminal-management workflow there.
- Regenerate harness docs from `scripts/harness-app-registry.ts` after changing
  this validation surface.
