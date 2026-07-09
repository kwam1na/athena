---
title: Athena POS Local Sync Contract Is Single-Sourced
date: 2026-07-09
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: pos
resolution_type: code_fix
severity: high
applies_when:
  - "Changing POS local sync event names, payloads, upload validators, or ingestion parsers"
  - "Adding browser-uploaded POS or expense local sync events"
  - "Debugging mismatches between browser local events and Convex sync ingestion"
tags:
  - pos
  - local-sync
  - convex
  - validators
  - local-first
---

# Athena POS Local Sync Contract Is Single-Sourced

## Problem

POS local sync had the same event contract repeated in several places: browser local event upload selection, dot-to-underscore event name mapping, public Convex upload validators, stored sync event literals, and Convex ingestion payload types. That made it possible for a future event change to pass one layer while silently drifting in another.

The highest-risk symptom was parser fallthrough: an unrecognized sync event type could reach ingestion and be interpreted as `register_reopened` because the final branch was the default return path.

## Solution

Keep event identity in `packages/athena-webapp/shared/posLocalSyncContract.ts`.

The shared contract owns:

- Cloud sync event names such as `sale_completed` and `expense_recorded`.
- Browser local event names such as `transaction.completed` and `expense.completed`.
- Sync scope, including the drawerless `expense` scope.
- Browser uploadability, including the deliberate `register.reopened` exception.
- Payload TypeScript shapes by sync event type.

Browser upload code uses the shared contract for uploadability and dot-to-underscore event identity. Convex public upload validation derives its event union from the same shared contract while keeping event-specific payload validators strict. Stored `posLocalSyncEvent.payload` stays broad for historical compatibility; only the event/status literals and public upload boundary are tightened.

Ingestion should still own semantic validation. Business rules, register/session references, staff proof behavior, inventory reconciliation, and expense totals remain server-authoritative. The contract change only removes duplicated shape ownership and adds an explicit fail-closed unknown-event guard before parser dispatch.

## Why This Matters

Local-first POS depends on stable retry behavior. A terminal can be offline, replay events later, and retry the same event after conflict or rejection. If browser conversion, public validation, and ingestion parsing drift independently, the same local event can be skipped, rejected, projected differently, or made unretryable depending on which layer was updated.

Single-sourcing the event identity map makes event additions obvious: update the shared contract, add or update the Convex payload validator for that event, update browser payload conversion if it is browser-uploaded, and add characterization coverage. The stored schema remains intentionally tolerant so old rows and review surfaces do not break when public validators become stricter.

## Prevention

- Do not add a POS sync event by editing only `syncContract.ts`, `public/sync.ts`, or `ingestLocalEvents.ts`.
- Keep browser uploadability separate from server event support; `register_reopened` is supported by ingestion but is not browser-uploaded from the normal replay path.
- Keep raw `staffProofToken` and terminal sync secrets transient. Persist only `staffProofTokenHash`, and do not add raw proof or secret values to payloads, conflicts, mappings, return metadata, or logs.
- Add a negative test for unknown event types so parser dispatch cannot fall through to a valid event.
- Keep public upload validators event-specific; do not replace them with a generic `payload: record` validator.
- Run focused browser sync, public sync, ingestion, projection, typecheck, architecture, Graphify, and `pr:athena` gates after changing this boundary.

## Examples

Correct browser/server event identity lookup:

```ts
canUploadPosLocalSyncLocalEventType("transaction.completed");
getPosLocalSyncEventTypeForLocalEventType("transaction.completed");
```

Correct ingestion posture:

```ts
if (!isPosLocalSyncEventType(event.eventType)) {
  return {
    ok: false,
    message: `Unsupported POS sync event type: ${String(event.eventType)}.`,
  };
}
```

This preserves local-first semantics: browser conversion remains best-effort and normalizing, while Convex ingestion remains the authoritative place for semantic rejection.

## Related

- `docs/solutions/architecture/athena-pos-local-first-sync-2026-05-13.md`
- `docs/solutions/architecture/athena-pos-hub-owned-local-sync-drain-2026-05-18.md`
- `docs/solutions/architecture/athena-pos-sync-projection-policy-boundary-2026-07-06.md`
- `docs/solutions/harness/convex-return-validator-contract-proof-2026-06-18.md`
- Linear: V26-966
