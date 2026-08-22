---
title: "An Escape Hatch Needs Its Own Sensor, and Behavior-Gating Enumerations Must Be Exhaustiveness-Pinned"
date: 2026-08-22
last_updated: 2026-08-22
category: harness
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A file or flag deliberately bypasses a default guard shared by its peers"
  - "An allowlist enum gates downstream behavior and producers can grow new members"
  - "A source union has members no code path can ever produce"
  - "Closing a migration gap across many CLIs at once"
tags:
  - harness
  - typed-blockers
  - blocker-contract
  - sensor-rules
  - exhaustiveness
  - gate-obligations
  - remediations
  - cli-boundary
delivery_diff_fingerprint: cf37f29ea47bde778030b3892553950a1ac5041ad48a02b50db7bcfde6e988fc
---

# An Escape Hatch Needs Its Own Sensor, and Behavior-Gating Enumerations Must Be Exhaustiveness-Pinned

## Problem

The typed-blockers migration (#783) converted most harness CLIs to emit contract-form blockers on blocking exits, but it left three kinds of holes that only human review was catching:

**Escape hatches without police.** A CLI could suppress the shared fallback error rendering with `renderNonZero: false` — an entitlement intended for CLIs that render their *own* conformant blocker instead. Nothing verified the replacement obligation actually happened, so a file could opt out of the fallback and then exit nonzero with raw output, silently outside the blocker contract. The bypass was caught by human review twice before any sensor existed.

**Allowlists that silently change meaning.** `WAIVABLE_FINDING_CODES` decides which blocked findings a human may waive. When a producer grows a new finding code, the allowlist does not fail — it quietly classifies the new code as not-waivable (or, worse, a parallel emittable list quietly includes it) with no decision ever being made. Enumeration growth changed semantics invisibly.

**Dead union members.** The preparation-blocker source id union contained `mechanical_failed`, which no producer emitted. Dead members make boundary maps inaccurate: consumers reason about sources that cannot occur, and maps keyed by the union carry entries with no reality behind them.

The batch (Linear epic V26-1307, tickets V26-1274/1276/1277/1278/1279/1284/1285) also migrated the last three excluded CLIs (`delivery-documentation-check`, `delivery-run-telemetry`, `pre-push-validation-proof`) into `runHarnessCliBoundary`, made interrupted runs and bad CLI flags contract-form (`delivery_run_interrupted`; a typed `harness_usage_error` with flags remediation instead of stack-trace internal errors), restored per-finding-code typed remediations in `remediationFor`, and collapsed a duplicate shell-quoting helper into canonical `formatHarnessCommand`.

## Solution

**Pair every deliberate bypass with a static rule that polices the entitlement.** The blocker inventory sensor (`scripts/harness-blocker-inventory.ts`) gained a `blocker-emission-missing` rule: a file passing `renderNonZero: false` must also construct a blocker (`createHarnessBlocker`, `HarnessBlockedError`, or `formatHarnessBlockers`). Suppressing the shared fallback without emitting a conformant replacement is now caught by the sensor on every run, not by whoever happens to read the diff.

**Pin every behavior-gating enumeration with exhaustive witnesses.** `scripts/harness-gate-admission.ts` now exports `EMITTABLE_BLOCKED_FINDING_CODES` and `INTENTIONALLY_NOT_WAIVABLE_FINDING_CODES` as `Record<ObligationId, readonly Code[]>` witnesses over the same obligation/code space. Because the Records are exhaustive over their key types, adding a finding code to a waiver obligation fails compile/test until someone classifies it as waivable or intentionally not. Growth forces a decision instead of defaulting into semantics.

**Require a named producer per union member.** The producer-less `mechanical_failed` source id was removed, and a pinning test now asserts every preparation blocker source has a named producer — so the next dead member is a test failure, not an audit finding.

## Why This Matters

A guard's strength is bounded by what polices its exceptions. `renderNonZero: false` was a one-token escape from the entire blocker contract, visible in review only to someone who knew both the flag and the replacement obligation — which is why humans caught it twice and a machine had caught it zero times. Static sensor rules convert that tribal knowledge into an invariant enforced on every inventory pass.

Allowlists have the same shape one level up: an enumeration that gates behavior is a decision table, and an unpinned decision table gets new rows written by whoever adds the next producer — by omission, not judgment. Exhaustive `Record` witnesses make the decision table structurally incapable of gaining an unclassified row. Dead union members are the inverse failure: rows nobody can reach, which make downstream maps lie about coverage.

All three fixes share one principle: when correctness depends on a set staying complete (every bypass policed, every code classified, every source produced), encode completeness in a type-level witness or a sensor rule rather than in convention.

## Prevention

- Whenever introducing or granting a bypass of a shared default guard, add the static rule that verifies the replacement obligation in the same change. If the bypass ships first and the sensor later, the window between is policed only by luck.
- Model behavior-gating allowlists as exhaustive `Record<KeyType, Value>` witnesses partitioning a shared space (the waivable/not-waivable pair partitions `EMITTABLE_BLOCKED_FINDING_CODES` exactly), so unclassified growth is a compile error.
- Pin producers per union member when the union feeds boundary maps; delete members that lose their producer rather than keeping them speculative.
- When migrating a boundary contract across many entry points, drive it through the single shared wrapper (`runHarnessCliBoundary`) and treat any excluded CLI as an open gap with a tracking ticket — exclusion lists drift exactly like unpinned enumerations.
- Prefer contract-form failures even for operator mistakes: a typed `harness_usage_error` with flags remediation is actionable where a stack trace is noise, and interrupted runs (`delivery_run_interrupted`) should be distinguishable from crashes.

## Examples

Before: a CLI sets `renderNonZero: false`, forgets the blocker — nothing fails until a reviewer notices raw stderr on a blocking exit. After: `harness-blocker-inventory` reports `blocker-emission-missing` for that file on the next run.

Before: a producer adds `new_finding_code`; waiver behavior changes silently depending on which list the author remembered to touch. After: the exhaustive Record witness fails typecheck until `new_finding_code` appears in `EMITTABLE_BLOCKED_FINDING_CODES` under either the waivable list or `INTENTIONALLY_NOT_WAIVABLE_FINDING_CODES`.

## Related

- [Review findings carry a scope axis, and delivery runs leave a durable record](scope-disciplined-review-and-durable-run-telemetry-2026-08-13.md) — the telemetry precedent the per-finding-code remediations follow, and the same "machine-checked, not trusted" posture for gate rules
- [Compound solution gate](compound-solution-gate-2026-05-05.md)
- [Candidate-bound human documentation waivers](../workflow-issues/candidate-bound-human-documentation-waivers-2026-08-14.md) — the waiver machinery the pinned classification lists protect
