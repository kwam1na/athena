---
title: Athena POS Remote Terminal Health Recovery
date: 2026-06-11
category: architecture
module: athena-webapp
problem_type: pos_remote_terminal_health_recovery
component: pos
symptoms:
  - "Support can diagnose an online POS terminal but cannot safely repair stale cloud and browser-local blockers remotely"
  - "Cloud duplicate drawer-open conflicts can outlive the real drawer lifecycle"
  - "Browser-local terminal integrity and drawer authority blocks require terminal-side repair and fresh runtime verification"
root_cause: terminal_health_had_evidence_without_a_safe_recovery_orchestration_boundary
resolution_type: terminal_recovery_orchestration
severity: high
tags:
  - pos
  - terminal-health
  - local-first
  - recovery
  - diagnostics
  - cash-controls
---

# Athena POS Remote Terminal Health Recovery

## Problem

Terminal Health can show that a POS terminal is active, checking in, and still
unable to sell. The blocker might be cloud evidence, such as stale duplicate
drawer-open conflicts, or browser-local state, such as terminal integrity,
drawer authority, staff authority, terminal seed, or stale snapshots.

Those blockers cannot all be repaired from the same side of the system. Convex
can resolve safe cloud-only evidence, but it cannot directly mutate the
terminal browser's IndexedDB authority state. The terminal must execute local
repair commands, run precondition checks, and publish a fresh runtime check-in
before support can trust that the blocker cleared.

## Boundaries

- Terminal recovery is orchestration, not a server-side force-clear.
- Cloud repair may resolve only allow-listed stale cloud evidence. It must not
  approve, project, delete, or rewrite completed sales, payments, inventory,
  closeouts, variances, or manager-review facts.
- Browser-local repair must be executed by the matching active terminal. It can
  repair terminal seed, terminal integrity, drawer authority, staff authority,
  snapshots, or diagnostics only after local precondition checks pass.
- Runtime check-in is the verification source. A command acknowledgement is not
  enough to mark a terminal healthy.
- Terminal Health remains support telemetry and recovery orchestration. Cash
  Controls and Operations remain the owners for reconciliation and manager
  review.

## Solution

Add a terminal recovery layer on top of existing terminal health evidence:

- Return a recovery preview from terminal health detail. The preview separates
  `healthy_idle`, `able_to_transact_now`, `needs_cloud_repair`,
  `needs_terminal_action`, and `needs_manual_review`.
- Keep `healthy_idle` distinct from `able_to_transact_now`. A healthy idle
  terminal has no known blocking setup, sync, or authority evidence; selling
  still requires the existing register, cashier, and sale context. Able-to-
  transact requires fresh runtime evidence of active sale authority.
- Resolve stale duplicate drawer-open conflicts only when the evidence proves
  they are duplicate lifecycle attempts for the same terminal and do not carry
  sale, payment, inventory, closeout, or variance facts.
- Queue terminal-scoped recovery commands for local repair. Commands are
  allow-listed, expiring, idempotent, and audited without secrets.
- Let the browser runtime claim commands, execute local repair through existing
  local store helpers, and publish a fresh runtime status after execution.
- Show recovery controls in Terminal Health detail, not Cash Controls. The UI
  should explain safe cloud repair, terminal-required action, manual-review
  blockers, and verification state without exposing backend exception text.

## Remote Command Operation

Terminal Health recovery controls issue only the action metadata returned by the
current recovery preview. Support does not type a command or edit payloads in the
browser. Cloud repair uses the preview precondition hash. Terminal-local repair
uses the preview command type, non-secret command context, and expected evidence.

Generic command examples:

- `repair_terminal_seed` may be queued when terminal setup data or terminal
  integrity is blocked. Expected evidence should ask the next terminal check-in
  to show terminal integrity healthy, and when relevant, terminal seed ready and
  local store available.
- `clear_stale_drawer_authority` may be queued when drawer authority is blocked
  by a stale local/cloud register-session pair. The command context should name
  the target local register-session id and cloud register-session id, and
  expected evidence should require drawer authority healthy for that local
  session.

Command acknowledgement and verification are separate. A completed
acknowledgement means the matching terminal ran the local helper and recorded the
result. Recovery is not verified until a fresh runtime check-in matches the
expected evidence. While a command is pending, claimed, completed, or waiting for
verification, Terminal Health should disable duplicate unsafe clicks.

Manual-review evidence remains outside remote terminal repair. Sale, payment,
inventory, closeout, variance, manager-rejected, and unresolved business-fact
items stay in Operations or Cash Controls. Remote terminal commands can clear
safe terminal-local setup and authority blockers only when their preconditions
still match.

## Validation

When this boundary changes, validate the whole recovery loop:

- Convex recovery preview and command contract tests.
- Safe cloud repair policy tests for duplicate drawer-open conflicts and skip
  cases.
- Terminal command queue tests for store/terminal scoping, expiry, idempotency,
  and acknowledgement.
- Browser runtime tests for terminal-local command execution and authority
  precondition checks.
- Terminal detail presentation tests for readiness, safe actions, manual
  blockers, and normalized copy.
- Harness coverage for any new backend, browser runtime, or UI files.

Run the focused terminal-health diagnostics suite, changed Convex/frontend
lint, typecheck, build, generated-artifact repair, harness review, graphify
rebuild/check, and `bun run pr:athena` before merge.

## Prevention

- Do not clear browser-local authority from Convex directly.
- Do not treat a command acknowledgement as proof that a terminal is healthy.
  Require a fresh runtime check-in with the expected blocker cleared.
- Do not auto-resolve conflicts tied to completed sale, payment, inventory,
  closeout, variance, or manager-review facts.
- Do not expose sync secrets, secret hashes, staff proof tokens, PIN/verifier
  material, raw local payloads, customer data, or payment details in recovery
  preview, command audit, acknowledgements, runtime status, or UI copy.
- Do not collapse `healthy_idle` and `able_to_transact_now`; support must know
  whether the terminal is merely ready for normal POS setup or already has
  active sale authority.
- Keep Cash Controls as the reconciliation owner. Terminal recovery can link to
  Cash Controls or Open Work, but it should not become a parallel manager-review
  workflow.

## Related

- [Athena POS Terminal Health Visibility](./athena-pos-terminal-health-visibility-2026-05-20.md)
- [Athena POS Terminal Runtime Review Actions](./athena-pos-terminal-runtime-review-actions-2026-05-28.md)
- [Athena POS Stale Terminal Sale Blocks](../logic-errors/athena-pos-stale-terminal-sale-block-2026-05-29.md)
- [Athena POS Local Staff Authority](./athena-pos-local-staff-authority-2026-05-14.md)
