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

Fresh runtime evidence can prove active local drawer evidence and sale authority, but cloud register lifecycle evidence remains the guardrail for sale-ready projection when it conflicts. Command acknowledgement is not verification; fresh runtime evidence is still required to verify recovery.

## Prevention

Future diagnostics or self-heal work should compare a redacted local terminal snapshot against this aggregate. It should not recreate raw joins from the ledgers, and it should route any action through the existing audited mutation paths.

When Terminal Health return shapes change, keep public Convex validators and frontend types in the same slice. When readiness semantics change, add policy tests and query projection tests so roster, detail, and `previewTerminalRecovery` cannot drift.
