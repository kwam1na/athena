---
title: "Athena terminal manager elevation is surface access, not command approval"
date: "2026-05-10"
category: logic-errors
module: athena-webapp
problem_type: terminal_elevation_command_boundary_confusion
component: manager-elevation
symptoms:
  - "A POS terminal needs temporary manager access to store-day surfaces"
  - "Manager presence can be mistaken for full_admin account access"
  - "Manager presence can be mistaken for an action-bound approval proof"
root_cause: terminal_elevation_and_command_approval_share_manager_language_but_have_different_authority_boundaries
resolution_type: separate_capability_layer_plus_command_proof_regressions
severity: high
tags:
  - athena
  - manager-elevation
  - command-approval
  - permissions
  - terminal-access
---

# Athena terminal manager elevation is surface access, not command approval

## Problem

Manager presence at a POS terminal can be useful for store-day navigation, but it is easy to accidentally treat that presence as a reusable approval token. That would blur two different boundaries:

- terminal elevation: temporary access to selected operational surfaces on one store terminal
- command approval: action-bound, subject-bound, expiring, one-use proof consumed by a protected mutation

If a screen or command treats elevated manager state as `full_admin` or as an approval proof, a POS-only account can gain broader admin access or bypass command-specific approval checks.

## Solution

Keep terminal elevation in its own table and capability path.

- Scope elevation by store, organization, terminal, signed-in Athena account, manager staff profile, credential, creation time, expiry, and end state.
- Authenticate elevation through active staff credentials with an active `manager` role for the current store.
- Query active elevation server-side; refresh should preserve only unexpired, unended records.
- Combine active elevation with account role in capability helpers. Elevation may unlock approved store-day surfaces, but it must not change the underlying account role or make `hasFullAdminAccess` true.
- Keep procurement, analytics, configuration, organization members, storefront admin, services admin, bulk operations, promo codes, and reviews admin tied to `full_admin`.
- Keep protected mutations on the existing command approval rail. Elevation state is not an `approvalProofId`, does not satisfy action/subject binding, and is never trusted from the browser as command authority.
- Record operational events for elevation lifecycle transitions so operator-facing access changes are auditable.

## Implementation Anchors

- Elevation persistence and lifecycle: `packages/athena-webapp/convex/operations/managerElevations.ts`
- Elevation schema: `packages/athena-webapp/convex/schemas/operations/managerElevation.ts`
- Client elevation provider: `packages/athena-webapp/src/contexts/ManagerElevationContext.tsx`
- Capability split: `packages/athena-webapp/src/lib/access/capabilities.ts`
- Shell access integration: `packages/athena-webapp/src/hooks/usePermissions.ts` and `packages/athena-webapp/src/hooks/useProtectedAdminPageState.ts`
- Command-bound proof enforcement: `packages/athena-webapp/convex/operations/approvalProofs.ts`

## Tests

Use this focused slice after changing manager elevation or adjacent access gates:

```bash
bun run --filter '@athena/webapp' test -- convex/operations/managerElevations.test.ts convex/operations/approvalProofs.test.ts src/contexts/ManagerElevationContext.test.tsx src/routes/_authed.test.tsx src/components/app-sidebar.test.tsx src/components/operations/OperationsQueueView.auth.test.tsx src/components/cash-controls/CashControlsDashboard.auth.test.tsx src/components/cash-controls/RegisterSessionView.auth.test.tsx
```

Then run:

```bash
bun run --filter '@athena/webapp' audit:convex
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run pre-commit:generated-artifacts
bun run pr:athena
```

## Prevention

- Do not model manager elevation as a role change. The signed-in account remains `pos_only` or `full_admin`.
- Do not pass elevation state into protected mutations as authority. Commands must validate membership, command approval proofs, or domain-specific authorization server-side.
- Do not reuse `approvalProofId` UI or data contracts for terminal elevation. A manager elevation id is not a proof id and must fail proof consumption.
- When adding store-day surfaces to elevation, update the capability helper and route/sidebar tests at the same time, then assert excluded admin surfaces remain excluded.
- Keep terminal elevation lifecycle events in `operationalEvent`; add workflow trace events only for domains that already own a lifecycle trace.
