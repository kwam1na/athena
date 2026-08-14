---
title: Candidate-bound human documentation waivers
date: 2026-08-14
category: workflow-issues
module: Athena delivery harness
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A human must accept a documentation exception that CI can verify"
tags: [waiver, attestation, github-actions, candidate-identity, human-approval]
delivery_diff_fingerprint: 4c21a0f5abedebcf481e373fab2f332fe7eb0bd5bf0f5d744997cbda834393f0
---

# Candidate-bound human documentation waivers

## Problem

A local prompt, PTY, or authenticated `gh` command cannot prove that a human approved an exception: an agent can operate all three. A portable waiver also becomes unsafe if it is reusable after the pull-request head, base, deliverable identity, or live findings change.

## Solution

Treat the command as a request, not the approval. Dispatch an unprivileged workflow that already exists on the default branch. Bootstrap the sole credential from the reviewer's iPhone with a one-time enrollment secret chosen and configured outside agent runtimes; WebAuthn verifies a platform authenticator, not the Apple device make. The authenticated Athena shell authorizes enrollment through a normal Convex mutation, which issues a one-minute, single-use ticket to the Node/WebAuthn ceremony. This keeps the server identity check authoritative even when action authentication propagation differs from the shell's query session, without trusting a visible route or caller-supplied reviewer email. After that trusted enrollment, the relay obtains a candidate-bound, single-use WebAuthn challenge from Athena and waits for the enrolled passkey to produce a user-verified assertion. Only then does its job-scoped `GITHUB_TOKEN` start the protected issuer as `github-actions[bot]`. The issuer verifies read-only provenance before consuming the passkey approval and remains paused behind a protected GitHub Environment for defense in depth. Consumption returns the same receipt only when retried for the exact candidate, allowing recovery from transient artifact/check publication failure without authorizing different work. The resulting artifact records the passkey credential, Bot relay, and environment reviewer and binds the decision to the repository, PR, head, base tip, merge base, deliverable-tree identity, and exact finding codes.

CI independently re-fetches the workflow run, requester type, and environment review history, downloads the immutable artifact, and recomputes the PR-head deliverable identity even while the rest of CI validates GitHub's synthetic merge commit. A successful assertion atomically opens a separate 10-minute issuer-consumption window, rather than reusing the 15-minute pending-authentication deadline. CI fails closed on a missing, expired, replayed, or mismatched passkey approval; a human or unknown relay actor; missing approval history; untrusted workflow provenance; candidate drift; or uncovered findings. The success check is published only after the artifact upload succeeds.

The first PR that introduces the default-branch workflow cannot use it. That bootstrap candidate must satisfy the ordinary documentation obligations; later candidates may request the waiver.

## Why This Matters

After the trusted bootstrap ceremony, the enrolled passkey assertion is the human-presence authority boundary. Candidate identity limits what that authority approves, while the protected GitHub Environment adds a second reviewer check and the synthetic merge checkout preserves normal merge-safety validation. Neither the dispatcher identity, an interactive terminal, nor possession of the reviewer's GitHub token substitutes for the user-verified passkey assertion.

## Prevention

- Keep Actions write permission inside the default-branch relay job. Never expose its `GITHUB_TOKEN` or any repository-scoped Actions-write installation token to the requesting process.
- Keep the broker secret only in GitHub Actions and Convex production configuration. Require WebAuthn user verification, exact RP ID/origin matching, a high-entropy public approval token, short expiry, and atomic single-use consumption.
- Require a separately held one-time enrollment secret, allow exactly one passkey enrollment for the configured reviewer email, and remove the bootstrap hash afterward; recovery or replacement must be an explicit operational reset, never an agent-accessible fallback.
- Bridge authenticated shell enrollment to Node/WebAuthn with a short-lived, single-use server record; never authorize from route visibility or a reviewer identity supplied by the browser.
- Configure `athena-documentation-waiver` with `kwam1na` as its required reviewer, self-review prevention, and no unsafe bypass before relying on the path.
- Keep the waiver workflow on the default branch and verify its artifact, workflow-run provenance, and approval history in CI.
- Recompute identity from the immutable PR head without changing the checkout used by the rest of required CI.
- Bootstrap changes to the waiver workflow through normal documentation.

## Examples

An agent may run `bun run harness:waive-documentation`, but that only creates a pending request. The relay exposes an approval link in its GitHub Actions summary; `kwam1na` opens it on the enrolled iPhone and confirms the exact candidate with Face ID, then approves the defense-in-depth GitHub Environment job. If the head or base moves afterward, CI rejects the old attestation.

## Related

- `docs/harness.md`
- `docs/solutions/architecture-patterns/candidate-bound-gate-obligations-before-expensive-validation-2026-08-11.md`
