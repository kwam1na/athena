---
title: "Athena Command Approval Policy Belongs at the Command Boundary"
date: "2026-05-01"
tags:
  - athena
  - approval-policy
  - command-boundary
  - operational-events
---

# Athena Command Approval Policy Belongs at the Command Boundary

Approval UI is only presentation. Any action that needs manager approval must let the command return a shared `approval_required` result and must enforce the approved retry server-side before mutating protected state.

## Problem

Manager sign-in can drift into individual screens. That makes each workflow look protected, but the command can still end up trusting browser-supplied actor data such as `staffProfileId`. Athena needs approval to work like an OS-level command precondition: any domain command can declare the approval it needs, the UI can present the right resolver, and the command can validate the resulting proof.

## Pattern

- Keep policy decisions domain-owned. Shared code defines the result contract, not every business rule.
- Return `approval_required` through `ApprovalCommandResult<T>` for commands that need approval.
- Mint inline manager approval through staff credentials into an `approvalProof` record.
- Bind approval proof to store, action key, subject type/id, required role, expiry, and one-use consumption.
- Consume approval proofs through the shared command approval helper so action, subject, requester, store, role, expiry, and one-use checks do not drift by workflow.
- Retry the same command path with `approvalProofId`; do not create a parallel manager-only mutation for the protected business logic.
- Use the existing `approvalRequest` rail for async approvals.
- In React, use the shared approval command runner so screens only submit the command, present returned approval requirements, mint proof, and retry through one reusable state machine.
- Record operational events for approval required, proof granted, proof consumed, async request created, decision recorded, and approved command applied.
- Add workflow trace milestones only when the domain already has a lifecycle trace, such as register session closeout.

## Implementation Anchors

- Shared command contract: `packages/athena-webapp/shared/commandResult.ts`
- Shared approval contract: `packages/athena-webapp/shared/approvalPolicy.ts`
- Convex result validators: `packages/athena-webapp/convex/lib/commandResultValidators.ts`
- Approval action/helper registry: `packages/athena-webapp/convex/operations/approvalActions.ts`
- Approval proof persistence and consumption: `packages/athena-webapp/convex/operations/approvalProofs.ts`
- Staff credential proof minting: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Approval runner: `packages/athena-webapp/src/components/operations/useApprovedCommand.tsx`
- Approval audit events: `packages/athena-webapp/convex/operations/approvalAuditEvents.ts`
- Generic presenter: `packages/athena-webapp/src/components/operations/CommandApprovalDialog.tsx`
- POS payment-method correction proof: `packages/athena-webapp/convex/pos/application/commands/correctTransaction.ts`
- Register variance async approval: `packages/athena-webapp/convex/cashControls/closeouts.ts`

## Tests

Use the focused command approval slice:

```bash
bun run --filter '@athena/webapp' test -- shared/commandResult.test.ts convex/lib/commandResultValidators.test.ts convex/operations/approvalProofs.test.ts convex/operations/approvalAuditEvents.test.ts convex/operations/staffCredentials.test.ts convex/pos/application/correctTransactionPaymentMethod.test.ts convex/pos/public/transactions.test.ts src/lib/errors/runCommand.test.ts src/lib/errors/presentCommandToast.test.ts src/components/operations/useApprovedCommand.test.tsx src/components/operations/CommandApprovalDialog.test.tsx src/components/pos/transactions/TransactionView.test.tsx convex/cashControls/closeouts.test.ts src/components/cash-controls/RegisterSessionView.test.tsx src/components/cash-controls/RegisterSessionView.auth.test.tsx src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/pos/register/POSRegisterView.test.tsx
```

Then run `bun run --filter '@athena/webapp' audit:convex`, `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`, `bun run graphify:rebuild`, and `git diff --check`.
