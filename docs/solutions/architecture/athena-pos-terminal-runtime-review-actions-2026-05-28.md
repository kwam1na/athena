---
title: Athena POS Terminal Runtime Review Actions
date: 2026-05-28
category: architecture
module: athena-webapp
problem_type: pos_terminal_runtime_review_actions
component: pos
symptoms:
  - "Terminal health can show attention without telling support where to act"
  - "Browser runtime check-in failures are invisible in the POS debug surface"
  - "Cloud conflicts and local runtime review can be conflated in terminal detail"
root_cause: terminal_health_evidence_lacked_action_targets_and_check_in_publish_state
resolution_type: terminal_evidence_action_boundary
severity: medium
tags:
  - pos
  - terminal-health
  - local-first
  - diagnostics
  - cash-controls
---

# Athena POS Terminal Runtime Review Actions

## Problem

Terminal Health is useful only when it separates evidence from the next action.
A stale check-in, a missing terminal seed, a local browser review item, and a
cloud sync conflict all require different operator paths. When the health
summary only reports that attention is needed, support has to infer whether to
open POS Settings, the register, Cash Controls, or Open Work.

The browser runtime also needs to report check-in publishing separately from
cashier sync. A failed runtime status check-in is diagnostic evidence. It must
not block local event upload, register commands, or closeout, but the debug
surface should show whether the check-in was accepted, rejected, unavailable, or
not ready because terminal setup is incomplete.

## Solution

Keep terminal review evidence as a read-side support boundary:

- Resolve each terminal attention reason to an explicit action target. Cloud
  conflict, held, and rejected evidence should link to the mapped Cash Controls
  register session when the local register session has a safe cloud mapping; if
  the mapping is unavailable, send support to Open Work.
- Route terminal setup gaps to POS Settings and local runtime or sync upload
  gaps to the POS Register. Do not add terminal-management mutations to Cash
  Controls.
- Include unresolved `posLocalSyncConflict` summaries in terminal sync evidence,
  but expose only safe fields: conflict id, type, timestamp, local event id,
  local register session id, sequence, and normalized summary.
- Track the latest review event separately from the latest event so action
  targeting can prefer the register session that actually needs review.
- Publish runtime check-ins best-effort from the browser. The publish path may
  update debug state, but it must not affect local upload scheduling or cashier
  command execution.
- Keep check-in publish debug fields out of the status publish signature. A
  fresh observation can publish again, but debug-only state transitions should
  not create a publish loop.

## UI Boundary

Terminal detail should present identity and latest check-in context separately
from sync evidence, conflicts, and support notes. The action buttons should be
commands to existing workspaces, not new workflows inside the detail page.

The POS debug strip can show check-in publish status, reason, timestamps, and a
short note. That copy is diagnostic. Operator-facing review copy should still
come from shared sync review state and conflict evidence.

## Inline Review Resolution Update

Remote terminal health can own the control plane without becoming a second
manager-review system. The terminal detail page may run the existing audited
register-session sync review resolver inline when the attention reason is
cloud/server review evidence and the backend has mapped that evidence to a real
Cash Controls register session.

Do not show that resolver for `local_runtime` review reasons. A terminal-local
review counter can remain after the server-side register review has already
settled. Routing that row through the register-session resolver produces an
`already_resolved` result but does not make the terminal healthy, because the
remaining evidence must come from the checkout browser retrying or reconciling
its local review events and publishing a fresh terminal check-in.

For terminal-local review, keep the page on terminal-side guidance or a
terminal-command path. If a future command can safely ask the browser to retry
uploaded review events, that command should report fresh runtime evidence back
through terminal health instead of patching the local review count from the
server.

## Regression Targets

- `convex/pos/application/terminals.test.ts` should prove attention reasons
  receive the right action target for POS Settings, POS Register, Open Work, and
  mapped Cash Controls register sessions.
- `convex/pos/infrastructure/repositories/terminalRepository.test.ts` should
  prove unresolved conflicts are store and terminal scoped, review events are
  selected from held/rejected/conflicted events, and local register session
  targets resolve only through safe mappings or matching cloud ids.
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts` should prove
  runtime check-ins are best-effort, expose accepted/rejected/not-ready states,
  clear stale completion timestamps while pending, and do not republish from
  debug-only changes.
- `POSTerminalDetailView.test.tsx` and `POSRegisterView.test.tsx` should prove
  the support actions and debug fields render without exposing terminal secrets
  or raw backend conflict language.
- Terminal detail tests should prove cloud/server review can resolve inline,
  while local-runtime review remains terminal-side guidance even when review
  evidence has a register-session id.

## Prevention

- Do not route all terminal attention to a single generic review page.
- Do not infer Cash Controls links from arbitrary local ids; require a
  `posLocalSyncMapping` register-session mapping or a normalized cloud
  `registerSession` id that belongs to the same store and terminal.
- Do not show a register-session resolver for terminal-local review counters.
  The server may already be settled while the browser still needs to check in.
- Do not treat runtime check-in failures as cashier command failures.
- Do not expose sync secrets, secret hashes, staff proof tokens, or raw local
  payload bodies in terminal health detail.
- Run the focused terminal/runtime tests and `bun run pr:athena` after changing
  this boundary.
