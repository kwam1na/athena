---
title: "Athena approval requester binding"
date: "2026-07-02"
category: logic-errors
module: athena-webapp
problem_type: approval_requester_identity_confusion
component: command-approval
symptoms:
  - "Valid manager credentials are rejected because requested staff profile does not match the signed-in Athena user"
  - "A POS or Cash Controls approval flow passes requestedByStaffProfileId from React into proof minting"
  - "Operational requester identity is confused with signed-in account identity"
root_cause: operational_staff_requester_attribution_reused_signed_in_user_linkage_validation
resolution_type: server_held_requester_challenge
severity: high
tags:
  - athena
  - command-approval
  - manager-approval
  - requester-binding
  - convex
related:
  - ./athena-command-approval-manager-fast-path-2026-05-02.md
---

# Athena approval requester binding

## Problem

Approval proof minting has three distinct requester modes:

1. **No requester**: the command intentionally has no operational staff requester.
2. **Direct signed-in requester**: `requestedByStaffProfileId` must belong to the signed-in Athena account through `linkedUserId`.
3. **Operational staff requester**: the command has already server-validated a staff actor for the store/action/subject, so proof minting must consume a short-lived server-held requester binding instead of revalidating against `linkedUserId`.

Do not use React state as the bridge between mode 2 and mode 3. If a workflow passes a UI-selected or locally authenticated `requestedByStaffProfileId` directly into `authenticateStaffCredentialForApproval`, proof minting will either reject valid operational staff who are not linked to the signed-in user or tempt a dangerous relaxation that would allow requester spoofing.

## Solution

The server command that returns `approval_required` owns requester binding. After it validates the operational actor, it creates a short-lived single-use `approvalRequesterChallenge` for the exact store, action key, subject, required role, and requester staff profile. The returned `ApprovalRequirement.requesterBinding` is then forwarded unchanged by `useApprovedCommand` or `CommandApprovalDialog` when manager credentials mint the approval proof.

The proof remains the only manager approval authority. The requester challenge only establishes who requested the command; it does not authorize the command and it is consumed before proof creation.

## Prevention

- Add `requesterBinding` to the server-returned `ApprovalRequirement` when a workflow needs operational requester attribution.
- Keep direct `requestedByStaffProfileId` proof-minting validation strict against `staffProfile.linkedUserId`.
- In React approval runners, pass `approval.requesterBinding` back to proof minting and send no requester when the server returned no binding.
- Reject calls that supply both direct `requestedByStaffProfileId` and `requesterBinding`.
- Bind the requester challenge to action key, store, subject type/id, required role, requester staff profile, expiration, and single-use consumption.
- Preserve requester/approver separation in approval proof audit events and domain evidence.

## Tests to include

- Unlinked Staff A requests a protected command, Manager Staff B approves through a matching requester binding, and the proof records Staff A as requester and Staff B as approver.
- Direct proof minting with unlinked Staff A still fails with the signed-in-user mismatch.
- Forged, stale, replayed, wrong-action, wrong-store, wrong-subject, and mixed direct-plus-binding evidence fail closed.
- Shared UI tests assert that React-supplied requester fallbacks are not sent to proof minting.
