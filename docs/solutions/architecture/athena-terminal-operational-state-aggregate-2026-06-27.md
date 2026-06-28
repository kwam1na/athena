---
title: Athena Terminal Operational State Aggregate
date: 2026-06-27
category: architecture
module: pos-terminal-health
problem_type: architecture_pattern
component: service_object
resolution_type: workflow_improvement
severity: medium
tags:
  - pos
  - terminal-health
  - recovery
  - query-boundary
related:
  - docs/solutions/architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md
  - docs/solutions/architecture/athena-pos-runtime-decoupling-boundaries-2026-06-15.md
  - docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md
---

# Athena Terminal Operational State Aggregate

## Problem

Terminal Health read semantics were split across local sync evidence, runtime status, active register sessions, recovery commands, cloud repair previews, and frontend fallback presentation. That made `TerminalRecoveryPreview` useful but still too narrow as the server truth boundary: new diagnostics could recreate raw joins from ledgers instead of reusing one policy output.

## Solution

Use `TerminalOperationalState` as the server-side read boundary for terminal health and recovery semantics. The aggregate is computed, query-safe, and non-actuating. It preserves the normalized source ledgers:

- `posTerminalRuntimeStatus`
- `posLocalSyncEvent`
- `posLocalSyncCursor`
- `posLocalSyncMapping`
- `posLocalSyncConflict`
- `registerSession`
- `posTerminalRecoveryCommand`

Repositories collect facts. Policy classifies facts. Existing mutations still own writes for runtime status reporting, recovery command lifecycle, cloud repair, sync ingestion, and manual review resolution.

Keep the output concepts separate:

- `salesReadiness`: `healthy_idle`, `drawer_open`, or `able_to_transact_now`
- `supportRecovery`: cloud repair, terminal action, or manual review when support work exists
- `diagnosticEvidence`: non-actuating stale or conflicting evidence for support/debugging
- `operationalExplanation`: the operator-facing lane, owner, sale impact, and next step derived from the same state

These concepts answer different questions and should not be collapsed:

- Sale readiness asks whether the cashier can sell now. A terminal can be `able_to_transact_now` while review work remains.
- Terminal health asks whether Athena has current, coherent runtime and ledger evidence. It can still be `needs_attention` for review backlog.
- Support recovery asks whether support has a safe action available, such as a terminal command or a narrow cloud repair.
- Review ownership asks which business workflow owns unresolved evidence. Cash Controls, Operations/Open Work, terminal-local retry, safe cloud repair, and diagnostic-only states are separate lanes.

Fresh runtime evidence can prove active local drawer evidence and sale authority, but cloud register lifecycle evidence remains the guardrail for sale-ready projection when it conflicts. Command acknowledgement is not verification; fresh runtime evidence is still required to verify recovery.

## Operational Explanation Boundary

Terminal Health should explain the relationship between current facts instead of exposing raw ledger joins to each UI surface. `operationalExplanation` is the extension point for that explanation. It can say "Review needed. Sales can continue." when sale readiness is intact but unresolved review evidence remains, or "Waiting for check-in." when runtime evidence is stale. It should also name the primary owner and the bounded evidence that led to the lane.

Safe cloud repair is never the explanation for business facts. The only repairable cloud lane is stale duplicate register/drawer-open lifecycle evidence that passes the existing source-event, store/terminal, stale-age, projection-safety, and precondition checks. Sale, payment, inventory, closeout, variance, customer, staff proof, unknown payload, and unresolved manual-review facts remain review-owned or diagnostic-owned evidence.

## Prevention

Future diagnostics or self-heal work should compare a redacted local terminal snapshot against this aggregate. It should not recreate raw joins from the ledgers, and it should route any action through the existing audited mutation paths.

When Terminal Health return shapes change, keep public Convex validators and frontend types in the same slice. When readiness semantics change, add policy tests and query projection tests so roster, detail, and `previewTerminalRecovery` cannot drift.

Any separately approved self-heal work should extend `operationalExplanation` and the existing recovery command/cloud-repair boundaries. It should not make the UI recompute terminal health from raw sync conflicts, nor should it let a support repair suppress or resolve manual-review facts as a side effect.
