---
title: Bound Convex DNS Recovery Without Mutating The Resolver
date: 2026-08-13
category: workflow-issues
module: generated-artifact harness
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - "`convex dev --once` retries and ends with `TypeError: fetch failed` before codegen output"
  - "The configured Convex deployment hostname does not resolve through the system resolver"
tags: [convex, dns, generated-artifacts, pre-commit, retries]
delivery_diff_fingerprint: 89ddc085b3d9cc00b513558d7970e46c854b684de56ecd79d68fede66f7fc418
---

# Bound Convex DNS Recovery Without Mutating The Resolver

## Problem

The Convex CLI internally retries deployment requests, but a system-resolver failure can still end with only `TypeError: fetch failed`. That output does not name the deployment hostname, distinguish DNS from credentials or source errors, or explain whether the delivery harness can repair the failure safely.

## Solution

Treat the generic fetch error as a signal to diagnose, not as proof of DNS failure:

1. Read the deployment hostname from `CONVEX_URL`, `VITE_CONVEX_URL`, or `CONVEX_DEPLOYMENT` without logging credentials.
2. Probe that hostname through Node's system resolver with a five-second timeout.
3. Retry `convex dev --once` exactly once only when the resolver probe fails.
4. Bound each Convex attempt. Confirm the timed-out child exits after `SIGTERM`, escalate to `SIGKILL` within another bounded grace, and fail closed without retrying if termination cannot be confirmed.
5. If DNS remains unavailable, report the hostname, resolver code, and next action. Never change system DNS from the harness.
6. Preserve credential, source, and type errors verbatim, including errors returned by the second attempt.

## Why This Matters

Resolver mutation is global, platform-specific, and unsafe for a commit hook. A narrow diagnosis plus one bounded retry handles transient failures without hiding persistent infrastructure problems. Confirming child termination also prevents concurrent Convex generators from racing over tracked `_generated` files.

Upgrading Convex is not a substitute for this boundary. During V26-1219, the repository's 1.43.0 CLI and the then-current 1.44.0 CLI both retried six times and ended with the same generic fetch failure while the deployment hostname was unresolved.

## Prevention

- Inject the resolver, retry delay, attempt timeout, and termination grace in focused tests; do not depend on live DNS for unit coverage.
- Cover persistent DNS failure, temporary recovery, a hanging resolver, a hanging Convex child, failed child termination, healthy DNS with a CLI timeout, and semantic errors on both attempts.
- Keep generated-artifact verification fail-closed after every unsuccessful refresh.

## Examples

Persistent resolver failure now ends with a diagnostic shaped like:

```text
DNS resolution failed for <deployment>.convex.cloud through the system resolver (EAI_AGAIN).
The harness retried `bunx convex dev --once` once and the deployment remained unreachable.
This harness does not change system DNS.
```

Credential or TypeScript output remains unchanged and is never relabeled as DNS.

## Related

- [Generated Artifact Repair Should Stage The Full Tracked Diff](../harness/generated-artifact-repair-full-tracked-diff-2026-05-02.md)
- [Convex Production Deploys Need A Supported Node Runtime](../harness/convex-prod-deploy-node-runtime-2026-05-09.md)
- [V26-1219](https://linear.app/v26-labs/issue/V26-1219/diagnose-convex-deployment-dns-failures-in-generated-artifact-hook)
