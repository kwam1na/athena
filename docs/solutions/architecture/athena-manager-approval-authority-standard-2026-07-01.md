---
title: Athena Manager Approval Authority Is Decision Evidence
date: 2026-07-01
category: architecture
module: athena-webapp
problem_type: manager_approval_authority_conflation
component: operations
symptoms:
  - "Manager approval flows can store the signed-in Athena user beside the manager staff profile that approved the command"
  - "Async approval replay can lose the approval proof that authorized the decision"
  - "Daily Ops evidence can blur requester, approver, and automation attribution"
root_cause: approval_resolution_persisted_review_actor_without_explicit_decision_evidence
resolution_type: decision_evidence_contract
severity: high
tags:
  - athena
  - approval-policy
  - manager-approval
  - staff-authority
  - audit
---

# Athena Manager Approval Authority Is Decision Evidence

## Problem

Manager approval is an authority decision, not a shortcut for changing the
current Athena session's staff identity. The browser can be signed in as one
Athena user while a different staff profile enters manager credentials or while
an async manager queue worker resolves a pending approval. If persistence only
stores `reviewedByUserId` and `reviewedByStaffProfileId`, later consumers can
misread the signed-in user as part of the approving staff profile.

That ambiguity is highest in workflows that replay protected commands after a
pending approval is approved: Cash Controls closeout review, POS transaction
voids and item adjustments, payment-method corrections, and Daily Close
completion/reopen.

## Solution

Every manager approval write should separate these lanes:

- Requester: the Athena user and staff profile that initiated the protected
  action, such as `requestedByUserId` and `requestedByStaffProfileId`.
- Reviewer session: the Athena user and staff profile that clicked approve,
  reject, or cancel in an async queue, such as `reviewedByUserId` and
  `reviewedByStaffProfileId`.
- Decision authority: the consumed manager proof and the staff profile that the
  proof authenticated, such as `decisionApprovalProofId` and
  `decisionApprovedByStaffProfileId`.
- Domain application: the business record fields that show what was changed by
  the approved command, such as `voidDecisionApprovalProofId`,
  `completionApprovalProofId`, or `reopenApprovalProofId`.
- Automation: automated Daily Ops completion carries automation policy/run
  evidence and must not backfill human manager proof fields.

Legacy compatibility fields can remain when readers already depend on them, but
new read models and audit views should prefer the explicit decision and
requester fields.

## Prevention

- Do not add a new manager approval write that only stores
  `reviewedByStaffProfileId`; persist the decision proof lane as well.
- Do not attach the signed-in Athena user to the approving staff profile. Store
  the signed-in user as requester or reviewer-session evidence depending on the
  command path.
- Keep inline manager approval proofs and async approval decisions on the same
  vocabulary: proof id, approved staff profile id, requester, reviewer session,
  and domain application fields.
- Keep Daily Ops automation evidence separate from human approval evidence.
- Update the focused approval tests when a new manager-approved command applies
  durable state.

## Implementation Anchors

- Approval request resolution and async decision evidence:
  `packages/athena-webapp/convex/operations/approvalRequests.ts`
- Approval request schema:
  `packages/athena-webapp/convex/schemas/operations/approvalRequest.ts`
- Cash Controls register closeout approval replay:
  `packages/athena-webapp/convex/cashControls/closeouts.ts`
- POS void replay and decision proof persistence:
  `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- POS item adjustment replay:
  `packages/athena-webapp/convex/pos/application/commands/adjustTransactionItems.ts`
- POS payment-method correction replay:
  `packages/athena-webapp/convex/pos/application/commands/correctTransaction.ts`
- Daily Close completion/reopen and automation attribution:
  `packages/athena-webapp/convex/operations/dailyClose.ts`

## Tests

Use focused command tests whenever this authority boundary changes:

```bash
cd packages/athena-webapp
bun run test -- convex/operations/approvalRequests.test.ts convex/cashControls/closeouts.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/adjustTransactionItems.test.ts convex/pos/application/correctTransactionPaymentMethod.test.ts convex/operations/dailyClose.test.ts
```

Then run the repo validation ladder: generated artifacts, typecheck, build or
package validation, `bun run graphify:rebuild`, and `bun run pr:athena`.
