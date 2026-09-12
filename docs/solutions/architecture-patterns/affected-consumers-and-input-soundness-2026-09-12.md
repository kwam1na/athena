---
title: Qualify affected consumers separately from evidence inputs
date: 2026-09-12
category: architecture-patterns
module: affected-validation-planner
problem_type: architecture_pattern
component: testing_framework
resolution_type: tooling_addition
severity: high
applies_when:
  - Selecting validation across base and candidate source snapshots
  - Declaring inputs for validation evidence reuse
  - Handling runtime dependencies outside static imports
tags: [affected-validation, dependency-analysis, input-soundness, runtime-contracts]
delivery_diff_fingerprint: 877ca31b49b31c18e2fc7f1cffa8a022497dc5c6c49cc12faad74f434d8fa5a6
---

# Qualify affected consumers separately from evidence inputs

## Problem

A directory map misses consumers across package boundaries and cannot describe generated registration or runtime filesystem reads. A narrow test selection also does not establish that a previous result remains valid after an unmodeled input changes.

## Solution

Resolve imports in both complete source snapshots and traverse the union of reverse edges from changed and old rename paths. Discover tests from candidate inventory. Keep deleted dependencies as absence assertions. In `scripts/harness-validation-impact.ts`, this graph is supplemented by the authored `VALIDATION_RUNTIME_RELATIONSHIPS` in `scripts/harness-app-registry.ts`: publishing, route registration, Convex schema/generated API consumers, and function admission.

Resolve TypeScript base URLs before treating bare imports as external packages. Treat Bun filesystem access as an unknown dependency unless a qualified contract bounds it. Configuration and setup-file changes affect implicit runner members even when a test also imports the configuration directly. Characterized Convex imports must remain unshadowed; an identifier with the same spelling is not proof that a call uses the imported factory.

Keep membership and input declarations separate. A known test that performs an unknown read may remain the only selected consumer while its possible inputs span the repository. Unsupported dependency forms retain an explicit fallback or block when no containing obligation exists. Evaluate uncertainty against the original affected closure so adding fallback tests does not recursively broaden unrelated packages.

Derive package ownership from the declared profile before command cwd. A root-invoked package typecheck still owns package source and configuration. Runtime publishing HTML does not become a typecheck input merely because the command runs at the root. A bounded filesystem exception applies only while the characterized reader source hash and applicable configuration guards match; changed reader implementation restores conservative handling. Raw source reads bind byte leaves without recursively executing the imports in those leaves. Type-only imports likewise do not imply runtime execution; package typechecks retain their transitive type inputs.

Group selected unit members by report dependence after binding each member. A genuine report consumer and an unrelated static test must not share an input union that invalidates both on every report edit. The canonical planner keeps at most two dependency groups per original unit check and preserves prerequisite/supersession references. A lazy docs-plugin factory import binds the producer source; its characterized runtime content module activates corpus reads.

Run the same consumer analysis for report-only changes. A publishing shortcut can omit real readers or suppress conservative fallback. Publishing builds may retain application inputs because they execute the actual application build; excluding those inputs would not establish sound reuse.

## Why This Matters

Membership determines what runs. Inputs determine what may invalidate its result. Narrowing both from the same incomplete graph can silently omit consumers or enable unsound reuse. Explicit runtime contracts make exceptions inspectable and prevent a static import graph from claiming to prove deployment behavior.

The planner remains read-only qualification under legacy gate authority. Actual execution bytes, dependency installation, runtime/toolchain, environment, and reusable evidence belong to the execution owner.

## Prevention

- Exercise deleted and renamed paths, redirected aliases, new tests, and removed edges across both snapshots.
- Keep negative controls for the base graph, exact-source filesystem guard, and unknown-input expansion. Removing each guard must fail its focused sensor; restoring the source must pass.
- Pair a direct consumer with an implicit or unsupported consumer in regression fixtures so the direct edge cannot mask an omitted consumer. Pin authored cross-root reader inputs with the actual source, as with the Storybook configuration reader.
- Characterize route registration before generated imports refresh, and retain distinct unit, typecheck, build, and browser profiles.
- Require the snapshot owner to establish regular-file containment or bind resolved symlink targets and membership before using finite reader contracts.
- Reject malformed snapshots, undeclared textual differences, inconsistent change statuses, and invalid fallback policy.
- Review fallback reasons and input declarations as well as membership counts. A smaller test count alone does not establish soundness.

## Examples

```sh
bun run harness:plan -- --input scripts/fixtures/affected-validation/impact/frontend-request.json --json
bun run harness:plan -- --input scripts/fixtures/affected-validation/impact/report-request.json --json
```

The frontend fixture selects the image utility test without its unrelated peer. The report fixture selects publishing and plan-integrity profiles. Neither result claims test execution: output retains `authority: legacy-gate` and `evidence: not-evaluated`.

Sensors live in `scripts/harness-validation-impact.test.ts`, `scripts/harness-app-registry.test.ts`, and `scripts/harness-validation-plan.test.ts`. The fixture README documents the caller's complete-inventory and execution-capture responsibilities.

## Related

- [Validation selection, membership, and evidence authority](../workflow-issues/validation-plans-membership-and-evidence-authority-2026-09-12.md)
- [The sensor ladder](../harness/the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md)
- [Convex deployment and module graph constraints](../harness/convex-deploy-and-module-graph-constraints-2026-08-22.md)
- [V26-2066](https://linear.app/v26-labs/issue/V26-2066)
