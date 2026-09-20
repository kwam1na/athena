---
title: Passive policy readers must not activate validation
date: 2026-09-20
category: integration-issues
module: Athena delivery harness
problem_type: integration_issue
component: development_workflow
symptoms:
  - "Importing blocker metadata can re-enter affected-plan capture."
  - "A staged documentation waiver unnecessarily depends on active health loading."
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [delivery, configuration, scoped-validation, documentation-waivers]
delivery_diff_fingerprint: 8eb3a13f623afe7fc107371716c48c683fb55fe0935eeeee74d0937b6d94f485
---

# Passive policy readers must not activate validation

## Problem

An affected-validation configuration does work when imported: it reads trusted
health and captures a candidate plan. Readers that only need declared policy
must not trigger those operations. Before separating these paths, importing
blocker metadata could re-enter plan capture, and resolving a documentation
waiver unnecessarily loaded active health.

## Symptoms

- Importing a named legacy configuration from `harness.config.ts` still
  evaluates that module's active top-level initialization.
- The staged-waiver regression fixture failed when its active entrypoint threw
  `ACTIVE_HEALTH_UNAVAILABLE`, even though declaration and identity inputs were
  available independently.

## What Didn't Work

Selecting a named export from an active module does not make its import passive.
Likewise, changing only the configuration entrypoint leaves transitive readers
such as blocker metadata, audit, and CI controllers on the same active path.

## Solution

Keep declared policy in `scripts/harness-base-config.ts`. The root entrypoint
owns mode selection and loads the local runtime only for an active scoped mode.
Static metadata imports the declaration directly. Dynamic readers use
`loadHarnessBaseConfig` with an explicit root; the loader requires a contained
regular file and validates the declaration without falling back to the active
entrypoint.

The CI controller supplies its authenticated pinned-base root. Documentation
admission uses declared policy for candidate capture and strict record-neutral
identity comparison. Preparation, live health checks, and actual local record
generation retain their active configuration paths.

```ts
// Identity evaluation needs declared policy, not a second admission run.
const config = await loadHarnessBaseConfig(rootDir);
const candidate = await (await wireRepo(rootDir, config)).captureCandidate();
```

## Why This Works

The split removes unintended work without changing who authorizes admission.
Real-Git tests compare complete candidate captures and strict identity pairs
under declared, comparison, and full-health configurations. Clean and staged
telemetry identities agree; staged source and report changes remain distinct.
The documentation tests also retain human-waiver authentication and preparation
requirements.

The documentation provider is unscoped and executes at the host root. Its bug
was unnecessary active configuration loading, not a demonstrated loss of
credentials inside a private snapshot. Keep those explanations separate.

## Prevention

- Test passive readers against an active entrypoint that deliberately throws.
- Keep the declared-policy module in preparation wiring inputs so edits
  invalidate preparation appropriately.
- Prove identity parity before changing a reader to declared policy; do not
  assume all consumers can safely stop using active configuration.
- Test trusted-base readers with a different or throwing candidate entrypoint.
  A missing trusted declaration must fail instead of using candidate policy.

## Related Issues

- [V26-2071 qualification and activation](https://linear.app/v26-labs/issue/V26-2071)
- [Layered policy projection](../harness/layered-policy-projection-read-only-comparison-2026-08-30.md)
