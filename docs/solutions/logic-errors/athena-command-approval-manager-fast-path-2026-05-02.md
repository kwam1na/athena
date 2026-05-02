---
title: "Athena command approval manager fast path"
date: 2026-05-02
tags:
  - athena-webapp
  - command-approval
  - manager-approval
  - staff-auth
---

# Athena command approval manager fast path

## Problem

Approval-aware workflows can accidentally ask a manager to authenticate twice: once to begin a workflow-specific action, and again after the command returns `approval_required`. The tempting fix is to let the screen pre-check manager status and mint a proof before submit, but that moves approval policy back into the UI.

## Pattern

Keep the command first. The screen may pass the fresh staff-auth credentials from the current modal submission into the shared approval runner. The runner executes the command without a proof, inspects the server-returned `ApprovalRequirement`, and only then attempts an inline manager proof when the requirement supports `inline_manager_proof`.

If proof minting succeeds, the runner retries the same command with `approvalProofId`. If the staff member is not manager-eligible, the requirement is async-only, proof minting fails, or the approved retry fails, the existing approval-required fallback and user-safe error handling remain in place.

## Rules

- Do not trust `staffProfileId` as approval. It is only the requester identity.
- Do not precompute approval policy in React. The command response owns action, subject, role, reason, and resolution modes.
- Do not store or reuse PIN hashes. Pass the current modal submission credentials directly into one immediate proof attempt.
- Do not replace `CommandApprovalDialog`. It remains the fallback when the same-submission fast path is unavailable.
- Keep audit and trace behavior server-owned through approval proof creation/consumption and the domain command.

## Current Consumers

- Transaction payment-method correction uses the same staff-auth submission to resolve the returned payment correction approval requirement.
- Cash-controls register-session closeout uses the shared runner instead of bespoke manager variance logic.
- POS register closeout routes through the same coordinator contract and can fast-path only when fresh closeout credentials are available.
