---
title: fix: Guard Convex return validator contract drift
type: fix
status: active
date: 2026-06-18
---

# fix: Guard Convex return validator contract drift

## Summary

Add a reusable Convex return-validator conformance helper and a repo-level inferential-review guard so changed public Convex functions with explicit `returns` validators must carry executable contract proof, not just loose exported-validator string checks.

---

## Problem Frame

PR #522 added new data to a public Convex terminal-health response, but the public `returns` validator was not updated until hotfix PRs #523 and #524. Production then rejected valid handler results with `ReturnsValidationError`. The durable gap is not terminal health itself; it is that local and CI sensors did not require changed public Convex return contracts to validate representative returned values against their exported validators.

---

## Requirements

- R1. Identify the production issue class from PRs #522, #523, and #524 without shaping the prevention around terminal-health-specific fields.
- R2. Provide a reusable test helper that can validate representative values against serialized Convex return validators.
- R3. Add a repo-level gate that flags changed public Convex functions with explicit `returns` validators when no executable return-contract proof is changed with them.
- R4. Keep existing public Convex functions thin; do not move application behavior into public modules only to make validation easier.
- R5. Preserve Athena validation workflow expectations: generated docs stay current, Graphify is rebuilt after code edits, and `pr:athena` remains the merge-grade local gate.

---

## Scope Boundaries

- The active fix is a generic contract guard for public Convex return validators.
- The terminal-health hotfix chain is audit evidence and one representative regression fixture, not the only guarded surface.
- This plan does not attempt static TypeScript-to-Convex-validator equivalence across the whole codebase.
- This plan does not add production log monitoring or change deploy/rollback procedures.

### Deferred to Follow-Up Work

- Broader live E2E coverage for Terminal Health routes can be planned separately if product coverage is still desired after the contract guard lands.
- Automatic generation of representative payload fixtures from application types is deferred; this plan uses explicit executable proof in tests.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/convex/pos/public/terminals.ts` is the recent public Convex boundary that drifted.
- `packages/athena-webapp/convex/pos/application/queries/terminals.ts` is the application-owned source of terminal-health return shape.
- `packages/athena-webapp/convex/pos/public/terminals.test.ts`, `packages/athena-webapp/convex/pos/public/transactions.test.ts`, and `packages/athena-webapp/convex/lib/commandResultValidators.test.ts` show current exported-validator inspection patterns.
- `scripts/harness-inferential-review.ts` is already in `bun run pr:athena` and emits structured blocking findings.
- `scripts/harness-inferential-review.test.ts` is the natural place to prove new deterministic inferential findings.
- `scripts/harness-app-registry.ts` owns generated validation-map/testing docs; update it rather than hand-editing generated docs.

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-register-sync-and-catalog-recovery-2026-05-26.md` says public POS sync results need validator-safe DTO shapes, not raw documents or unvalidated fields.
- `docs/solutions/logic-errors/athena-pos-terminal-review-reason-reconciliation-2026-05-26.md` says terminal health public validators must move with presentation-safe backend reason fields.
- `docs/solutions/logic-errors/athena-command-approval-policy-boundary-2026-05-01.md` treats Convex validators as API contract surfaces that need focused tests.
- `docs/solutions/harness/pr-athena-prepare-validate-proof-2026-06-13.md` keeps the merge-grade validation tree explicit through `pr:athena`.

### Hotfix Audit Evidence

- PR #522 (`772dae22`) added `recoveryPreview.appUpdate` and `recoveryPreview.commandStatus.appUpdateCommandExecutionId` to the application result shape.
- PR #523 (`edeba3b9`) allowed `recoveryPreview.appUpdate` in the public return validator, but still missed the nested command-status field.
- PR #524 (`54401e52`) allowed `recoveryPreview.commandStatus.appUpdateCommandExecutionId`.
- Existing tests proved application behavior and string-checked exported validator JSON, but did not validate representative handler output against the exported `returns` validator.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input -- un-validated bets that should be reviewed before implementation proceeds.*

- A deterministic harness rule is the right enforcement point because `harness:inferential-review` already blocks `pr:athena`.
- The first guard should require executable proof near tests rather than attempting whole-repo type/validator equivalence.

---

## Key Technical Decisions

- Add a reusable serialized-validator assertion helper instead of adding more string-token checks: string checks missed the nested field in #523, while value conformance catches missing object properties and unexpected returned fields.
- Use `scripts/harness-inferential-review.ts` for repo-level enforcement: it already evaluates changed files relative to `origin/main`, emits machine-readable findings, and runs inside `pr:athena`.
- Require changed proof, not merely the existence of any historical test: a new public Convex return field must be accompanied by a changed test/helper usage so reviewers see the contract was considered in that PR.
- Keep terminal-health-specific regression as a sample consumer of the generic helper, not the primary prevention mechanism.

---

## Open Questions

### Resolved During Planning

- Should the catch target terminal health specifically? No. The user explicitly narrowed the desired catch to the class of Convex return-validator drift.
- Should this live only in `audit:convex`? No. `harness:inferential-review` provides better structured remediation and already gates `pr:athena`.

### Deferred to Implementation

- Exact marker/helper name: choose the simplest readable name once the helper and harness test shape are in code.
- Exact changed-test matching heuristic: tune against existing public Convex test locations while avoiding a broad false-positive sweep.

---

## Implementation Units

- U1. **Reusable return-validator conformance helper**

**Goal:** Provide a test helper that validates representative returned values against a function's exported Convex `returns` validator.

**Requirements:** R2, R4

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/convex/lib/returnValidatorContract.ts`
- Test: `packages/athena-webapp/convex/lib/returnValidatorContract.test.ts`

**Approach:**
- Parse exported validator JSON from public Convex function definitions.
- Walk common Convex validator shapes used in this repo: object, union, array, record, literal, primitives, null, id, any, and optional object fields.
- Treat extra object fields as failures so tests mimic the production class where returned fields are not allowed by the public return validator.
- Return actionable path-aware errors for missing, extra, or wrong-type fields.

**Execution note:** Start with failing helper tests for missing nested object fields and extra nested object fields before wiring consumers.

**Patterns to follow:**
- `packages/athena-webapp/convex/lib/commandResultValidators.test.ts`
- `packages/athena-webapp/convex/pos/public/transactions.test.ts`

**Test scenarios:**
- Happy path: representative object matches a nested serialized validator -> assertion passes.
- Error path: returned object contains an extra nested field not present in validator -> assertion fails with that field path.
- Error path: returned object omits a required nested field -> assertion fails with that field path.
- Edge case: union validator accepts a matching variant and rejects values that match none.
- Edge case: optional fields may be absent but validate when present.

**Verification:**
- Helper tests fail on contract drift shapes equivalent to the #522/#523 misses and pass for valid representative values.

- U2. **Generic inferential-review guard**

**Goal:** Block `pr:athena` when a changed public Convex function with an explicit return validator lacks changed executable return-contract proof.

**Requirements:** R3, R5

**Dependencies:** U1

**Files:**
- Modify: `scripts/harness-inferential-review.ts`
- Test: `scripts/harness-inferential-review.test.ts`

**Approach:**
- Include changed `packages/athena-webapp/convex/**/*.ts` public modules in deterministic inferential review targets while excluding generated files, schema files, and tests from source-function detection.
- Detect exported `query`, `mutation`, and `action` definitions that contain `returns:`.
- Accept the change only when the changed file set also includes a relevant test using the reusable return-validator contract helper or a documented marker tied to the changed public module/export.
- Emit a structured finding with remediation that asks for representative handler/presenter return values to be validated against exported `returns`, not for field-name string checks.

**Execution note:** Characterize current changed-file targeting behavior first, then add the Convex contract collector.

**Patterns to follow:**
- `scripts/harness-inferential-review.ts`
- `scripts/harness-inferential-review.test.ts`

**Test scenarios:**
- Happy path: changed public Convex source with `returns:` plus changed sibling contract test using the helper -> no finding.
- Error path: changed public Convex source with `returns:` and no changed contract proof -> `missing-convex-return-validator-contract-proof`.
- Edge case: changed Convex test/helper files alone do not trigger source findings.
- Edge case: changed generated Convex files and schema-only modules are ignored.
- Error path: loose `exportReturns()` string inspection without helper/marker does not satisfy proof.

**Verification:**
- Inferential-review tests prove the rule is generic and does not mention terminal health fields.

- U3. **Representative public-contract fixture**

**Goal:** Convert the recent terminal-health crash chain into one consumer of the generic helper so the helper proves the production class on a real Athena public boundary.

**Requirements:** R1, R2, R4

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/terminals.test.ts`

**Approach:**
- Replace or augment loose validator string assertions with a representative value conformance assertion.
- Include nested app-update and command-status fields because they are the recent proof case, but keep the test phrasing about exported return-validator conformance rather than terminal-specific prevention.
- Keep existing unsafe-payload exclusions if they still provide useful security signal.

**Patterns to follow:**
- `packages/athena-webapp/convex/pos/public/transactions.test.ts`
- `packages/athena-webapp/convex/pos/application/queries/terminals.test.ts`

**Test scenarios:**
- Happy path: representative terminal-health summary with nested recovery preview conforms to `listTerminalHealthSummaries.exportReturns()`.
- Happy path: representative terminal-health detail summary conforms to `getTerminalHealthSummary.exportReturns()`.
- Error path: unsafe payload fields remain absent from exported validator JSON.

**Verification:**
- The representative contract test would have failed for #522 and after partial #523 before #524.

- U4. **Harness documentation and generated artifacts**

**Goal:** Make the new generic guard discoverable and keep generated docs/Graphify current.

**Requirements:** R5

**Dependencies:** U2, U3

**Files:**
- Modify: `scripts/harness-app-registry.ts`
- Generated: `packages/athena-webapp/docs/agent/testing.md`
- Generated: `packages/athena-webapp/docs/agent/validation-map.json`
- Generated: `packages/athena-webapp/docs/agent/validation-guide.md`
- Generated: `graphify-out/graph.json`

**Approach:**
- Update the Convex/backend validation guidance to mention return-validator contract proof for changed public Convex functions with explicit `returns`.
- Regenerate harness docs through the repo generator rather than hand-editing generated files.
- Rebuild Graphify after code edits.

**Patterns to follow:**
- `packages/athena-webapp/docs/agent/testing.md`
- `docs/solutions/harness/pr-athena-prepare-validate-proof-2026-06-13.md`

**Test scenarios:**
- Test expectation: none -- generated documentation and graph artifacts are validated by harness commands rather than feature tests.

**Verification:**
- Generated docs reflect the new guard and no stale generated artifact diff remains.

---

## System-Wide Impact

- **Interaction graph:** The guard affects repo validation and public Convex test practices, not runtime behavior.
- **Error propagation:** Contract drift should fail locally as a harness finding or focused test failure before it can become a production `ReturnsValidationError`.
- **State lifecycle risks:** No persistent data changes.
- **API surface parity:** Public Convex functions with `returns` validators become explicitly covered when changed.
- **Integration coverage:** Representative value validation complements existing typecheck, build, Convex audit, and behavior tests.
- **Unchanged invariants:** Public Convex modules remain thin wrappers around application logic; existing validators remain the production contract source.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Harness rule is too noisy for unrelated Convex edits | Scope detection to public exported functions with explicit `returns`, and add ignored cases for generated, schema, and test-only files. |
| Helper diverges from Convex runtime semantics | Keep supported validator shapes limited to repo-used serialized validators and add path-aware tests for every supported shape. |
| Existing string-only tests falsely satisfy the new guard | Require the helper call or explicit contract-proof marker, not arbitrary `exportReturns()` token checks. |
| Generated docs drift | Run the harness generator and Graphify rebuild before final validation. |

---

## Documentation / Operational Notes

- The audit finding should be summarized in PR/Linear notes: #522 introduced a public return shape change, #523 and #524 patched validator misses, and the new guard prevents this class by requiring executable return-contract proof.
- No production deploy is part of this plan unless a later instruction requests it; this is a validation-sensor hardening change.

---

## Sources & References

- Related PR: [#522](https://github.com/kwam1na/athena/pull/522)
- Related PR: [#523](https://github.com/kwam1na/athena/pull/523)
- Related PR: [#524](https://github.com/kwam1na/athena/pull/524)
- Related code: `packages/athena-webapp/convex/pos/public/terminals.ts`
- Related code: `packages/athena-webapp/convex/pos/application/queries/terminals.ts`
- Related code: `scripts/harness-inferential-review.ts`
- Related docs: `packages/athena-webapp/docs/agent/testing.md`
- Related learning: `docs/solutions/logic-errors/athena-pos-register-sync-and-catalog-recovery-2026-05-26.md`
