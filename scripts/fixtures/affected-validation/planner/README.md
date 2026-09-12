# Canonical plan qualification contract

`bun run harness:plan -- --input <request.json> [--json]` is read-only. The
request supplies a mode (`delivery`, `comparison`, `full-health`), semantic
changes (`path`, `status`, and `oldPath` for renames), and a repository-relative
file inventory. An optional canonical registry supports standalone qualification
fixtures. The ordinary registry is derived from `harness-app-registry.ts`.

All modes retain `authority: legacy-gate` and `evidence: not-evaluated`. Nothing
here executes a check, changes admission, reads a receipt, or claims a cache hit.
Comparison computes selection without running a second gate. Full-health selects
every registered check even when changes are empty. Delivery with no changes
still names the always-required plan-integrity obligation.

The exported `CanonicalValidationRegistry` declares each check's stable ID,
profile, argv, logical cwd, repository-relative test membership, input paths,
absence assertions, prerequisites and explicit supersession. The exported
`buildValidationPlan` returns deterministic checks with reasons and covered IDs.
Equivalent argv/cwd/profile/input contracts union membership. Distinct coverage,
timer and browser profiles stay distinct. Supersession requires matching profiles,
a stated reason, matching cwd and containing membership; chained supersession is
rejected. Prerequisites are retained even when another check could cover them.

For normalized unit checks, argv is the runner prefix and membership supplies
repository-relative test arguments (make them relative to cwd before execution).
Other commands retain their authored shell argv; their membership describes the
characterized runner inventory. This interface is not an execution API. Root
harness test selection remains full-inventory because the current command does
not accept a selected-membership restriction.

`identity` fingerprints declarations and selected membership, **not file bytes
or passing evidence**. The product must capture source bytes, toolchain,
environment, policy and provenance before evaluating reuse. The impact lane must
supply dependency closures and actual base/candidate inventories. The foundational
planner blocks unmapped changes rather than assuming no impact. It does not
claim reverse-consumer analysis is implemented.

`characterization.json` retains selection expectations from the legacy executor.
The tests inject no-op executors; no durations or test success are inferred from
selection. `report-request.json` and `report-plan.json` demonstrate the proposed
publishing obligations beside the characterized broad gate. Historical PR #837
latency is context only, not a benchmark for this implementation.

Typed diagnostics: `malformed-map`, `unknown-check`, `cyclic-prerequisite`,
`uncovered-input`, `empty-plan`, and `invalid-supersession`. CLI diagnostics use the
repository blocker envelope with command source `harness:plan`.
