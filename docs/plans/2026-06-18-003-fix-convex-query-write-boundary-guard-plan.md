---
title: fix: Guard Convex query write-boundary drift
type: fix
status: active
date: 2026-06-18
---

# fix: Guard Convex query write-boundary drift

## Summary

Add a type-level and harness-level guard so Convex query handlers cannot obtain mutation-only DB capabilities through shared repositories or services. The immediate terminal-recovery hotfix removed the read-path write, but the durable fix is to make read/write repository capability explicit and fail local validation when changed query code can reach `db.patch`, `db.insert`, `db.replace`, or `db.delete`.

---

## Problem Frame

Production hit `Uncaught TypeError: t.db.patch is not a function` from `terminalRecoveryRepository.ts` while serving `listTerminalRecoveryCommands`, a public Convex query. The query passed `QueryCtx` into `createTerminalRecoveryCommandRepository(ctx)`. That repository accepted `QueryCtx | MutationCtx`, exposed write methods, and cast to `MutationCtx` inside `patchCommand`.

The hotfix made `listClaimableTerminalRecoveryCommands` filter expired commands without patching during listing. That fixes the current crash, but the broader production gap is that local sensors allowed query code to receive a write-capable repository until runtime.

---

## Requirements

- R1. Preserve the terminal-recovery hotfix behavior: query/list paths filter expired commands without persisting status changes.
- R2. Split terminal-recovery command repository capability so query handlers can only receive read methods, while mutations keep write methods.
- R3. Split terminal-recovery service behavior so query-safe listing computes claimability without persistence, while mutation-only flows own expiry, insert, claim, acknowledgement, and verification writes.
- R4. Add focused regression tests proving the query-shaped read path works without `db.patch` or `db.insert`.
- R5. Add a deterministic `harness:inferential-review` guard for changed Convex code that reintroduces query-to-write-boundary violations.
- R6. Keep the guard analogous to the recent Convex return-validator guard: fail locally in `pr:athena`, emit structured remediation, and document the new sensor in generated validation guidance.
- R7. Preserve Athena delivery posture: Graphify rebuilt after code edits, focused tests first, then `pr:athena` before merge.

---

## Scope Boundaries

- Active scope is Convex query purity around mutation-only DB methods and write-capable repositories/services.
- The first type-level refactor is terminal-recovery command repositories because that is the observed production crash path.
- The harness guard should apply to changed Convex files rather than sweeping every historical mixed repository in one PR.
- This plan does not add a cron job to expire stale terminal recovery commands. Listing remains read-only; mutation paths still persist expiry when they claim or issue commands.
- This plan does not attempt a full TypeScript call graph. It uses targeted deterministic checks for the dangerous patterns that produced this incident.

### Deferred to Follow-Up Work

- Broader migration of unrelated repositories to explicit read/write factories can be planned separately if the new guard surfaces existing drift during future changes.
- A deeper AST or TypeScript program-analysis guard can replace the heuristic detector later if false negatives appear.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/convex/pos/public/terminals.ts` exports the public terminal recovery query and mutations.
- `packages/athena-webapp/convex/pos/application/terminalRecovery/terminalCommandService.ts` owns command issuing, listing, claiming, acknowledgement, and verification behavior.
- `packages/athena-webapp/convex/pos/infrastructure/repositories/terminalRecoveryRepository.ts` currently accepts `QueryCtx | MutationCtx` and casts to `MutationCtx` for write methods.
- `scripts/harness-inferential-review.ts` already hosts deterministic repo blockers, including the recent public Convex return-validator proof guard.
- `scripts/harness-inferential-review.test.ts` has fixture-driven tests that prove blocking findings for changed Convex files.
- `scripts/harness-app-registry.ts` owns generated validation guidance for Athena package docs.

### Institutional Learnings

- `docs/solutions/harness/convex-return-validator-contract-proof-2026-06-18.md` established the pattern for turning a production-only Convex server crash class into executable proof plus an inferential-review blocker.
- `docs/plans/2026-06-18-002-fix-convex-return-contract-guard-plan.md` used `harness:inferential-review` as the repo-level enforcement point because it already runs under `pr:athena`.
- `docs/solutions/logic-errors/athena-command-approval-policy-boundary-2026-05-01.md` reinforces that write behavior belongs behind command/mutation boundaries, not query-facing shared helpers.
- `packages/athena-webapp/docs/agent/validation-guide.md` already treats Convex boundary changes as focused validation-map surfaces that must run `audit:convex`, changed Convex lint, and typecheck.

### Subagent Findings

- The repo research agent recommended splitting terminal-recovery command repositories into read and write capabilities, then adding a changed-file inferential guard for query handlers and mixed `QueryCtx | MutationCtx` repositories.
- The learnings agent found no prior solution doc directly naming repository write methods reachable from query handlers, so this delivery should add a new solution learning after implementation.
- The spec-flow agent identified the core acceptance criteria: changed queries must fail local validation for direct mutation-only DB calls and the known mixed `QueryCtx | MutationCtx` repository/cast pattern, while mutations using write repositories remain allowed. Broader indirect call-graph reachability is intentionally deferred unless it is covered by those patterns or by a query-facing service/repository fixture.

---

## Assumptions

*This plan was produced in an execution pipeline without a separate user confirmation pause. The items below are agent inferences that should be reviewed during implementation and code review.*

- Read-time stale terminal recovery cleanup should stay as filtering, not persistence.
- Query handlers should be allowed to use repositories only when the repository factory returns a statically read-only interface.
- The first deterministic guard should focus on changed files and known-dangerous patterns to avoid turning this PR into a broad historical cleanup.
- `harness:inferential-review` is the correct enforcement point because it already fails `pr:athena` and has precedent from the return-validator guard.

---

## Key Technical Decisions

- Use type separation as the first line of defense: read repositories accept `QueryCtx | MutationCtx`; write repositories require `MutationCtx`.
- Keep terminal recovery listing read-only even when it encounters expired commands; mutation paths such as issue/claim/acknowledge remain responsible for persisted status changes.
- Add focused runtime-shaped tests for the production incident, not only service mocks, because the prod crash came from passing a query-shaped ctx through a write-capable abstraction.
- Add a deterministic inferential-review guard rather than relying on reviewer attention. The guard should produce actionable remediation: split read/write repositories or require `MutationCtx` for write-capable factories.
- Update generated validation guidance through the registry so future agents see this as a Convex boundary rule.

---

## Implementation Units

### U1. Terminal Recovery Repository Capability Split

**Goal:** Make terminal recovery command reads usable from queries while write methods require mutation context.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/terminalRecovery/terminalCommandService.ts`
- Modify: `packages/athena-webapp/convex/pos/infrastructure/repositories/terminalRecoveryRepository.ts`
- Modify: `packages/athena-webapp/convex/pos/public/terminals.ts`

**Approach:**
- Introduce a read-only terminal recovery command repository interface for `getCommand` and `listCommandsForTerminal`.
- Keep the write-capable repository interface for `insertCommand` and `patchCommand`.
- Add a read repository factory accepting `QueryCtx | MutationCtx`.
- Change the write repository factory to require `MutationCtx`.
- Update `listClaimableTerminalRecoveryCommands` to accept only the read interface.
- Keep query-safe listing functions limited to computing expired/claimable state without patching.
- Keep mutation-side command functions responsible for expiry persistence, insert, claim, acknowledgement, and runtime verification writes.
- Update public query call sites to use the read factory and mutation call sites to use the write factory.

**Execution posture:** Test-first for the read-only query-path behavior, then implementation.

**Test scenarios:**
- Listing expired pending/claimed commands returns only valid claimable commands and does not call `patchCommand`.
- A query-shaped ctx with no `patch` or `insert` can list terminal recovery commands through the read repository.
- Issue, claim, acknowledge, and verification flows still use write-capable repositories and persist expected patches.

**Verification:**
- Focused terminal recovery service and repository tests pass.
- Typecheck fails if a query passes `QueryCtx` into the write factory.

### U2. Public Query Regression Coverage

**Goal:** Ensure the public terminal recovery query path cannot regress to a write-capable repository without a test failure.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/terminals.test.ts`
- Modify: `packages/athena-webapp/convex/pos/infrastructure/repositories/terminalRecoveryRepository.test.ts`
- Modify: `packages/athena-webapp/convex/pos/application/terminalRecovery/terminalCommandService.test.ts`

**Approach:**
- Keep the existing service-level expectation that listing expired commands filters without patching.
- Add repository-level coverage for read repositories backed by a query-shaped db.
- Add public-module coverage that `listTerminalRecoveryCommands` is wired to a read repository while command mutations retain write wiring.

**Execution posture:** Test-first.

**Test scenarios:**
- Public list query returns claimable commands when the db object lacks write APIs.
- Public list query filters unsupported app-update commands based on runtime capability without writing.
- Claiming an expired command still patches the command to expired in mutation context.

**Verification:**
- Focused public terminals test suite passes.

### U3. Deterministic Inferential-Review Guard

**Goal:** Block changed Convex code that reintroduces query-to-write-boundary violations before it can merge.

**Requirements:** R4, R5

**Dependencies:** None

**Files:**
- Modify: `scripts/harness-inferential-review.ts`
- Modify: `scripts/harness-inferential-review.test.ts`

**Approach:**
- Detect changed Convex `query` and `internalQuery` modules that directly call mutation-only DB methods from handler code.
- Detect changed repository modules that combine `QueryCtx | MutationCtx` with casts to `MutationCtx` and mutation-only DB methods.
- Detect changed query-facing service or repository files that expose write methods while accepting query-compatible inputs, including the incident pattern where an unchanged query imports a changed service that can call `repository.patchCommand`.
- Make aliases and casts first-class fixtures: type aliases for mixed ctx, `ctx as MutationCtx`, `ctx as unknown as MutationCtx`, and `Pick<QueryCtx | MutationCtx, "db">` style ctx shapes should be represented in tests.
- Ignore generated files, schema-only files, tests, and changed mutation-only code.
- Emit a high-severity structured finding with remediation that names read/write repository splitting and `MutationCtx`-only write factories.
- Keep the rule deterministic and changed-file scoped, with rollout semantics that fail newly introduced mixed write surfaces or changed query-facing write methods rather than forcing historical cleanup in this PR.

**Execution posture:** Test-first with fixture repositories.

**Test scenarios:**
- Fails: changed public query directly calls `ctx.db.patch`.
- Fails: changed internal query casts `ctx` or `ctx.db` to a write-capable shape before patching.
- Fails: changed repository accepts `QueryCtx | MutationCtx`, casts to `MutationCtx`, and writes.
- Fails: changed service or repository path reachable from a query-facing module accepts a query-compatible repository and calls a write method.
- Fails: aliases and double casts hide the mixed ctx/write method shape.
- Passes: changed query uses a read-only repository with no write methods.
- Passes: changed mutation uses a write-capable repository.
- Passes: changed read helper accepts `QueryCtx | MutationCtx` but performs only reads.
- Passes: read-only edits to an existing mixed repository do not fail unless they introduce or change a query-facing write surface.

**Verification:**
- `bun test scripts/harness-inferential-review.test.ts`
- `bun run harness:inferential-review`

### U4. Harness Guidance, Generated Docs, and Learning

**Goal:** Make the new prevention rule discoverable and keep generated repo artifacts current.

**Requirements:** R5, R6

**Dependencies:** U3

**Files:**
- Modify: `scripts/harness-app-registry.ts`
- Generated: `packages/athena-webapp/docs/agent/testing.md`
- Generated: `packages/athena-webapp/docs/agent/validation-guide.md`
- Generated: `packages/athena-webapp/docs/agent/validation-map.json`
- Generated: `graphify-out/graph.json`
- Create: `docs/solutions/harness/convex-query-write-boundary-proof-2026-06-18.md`

**Approach:**
- Add guidance that query handlers must not reach mutation-only DB APIs directly or through write-capable repositories.
- Regenerate package agent docs through the existing harness generator.
- Rebuild Graphify after code edits.
- Add a compact solution doc recording the new production class and prevention pattern.

**Execution posture:** Sensor-only for generated docs; documentation as compounding work.

**Test scenarios:**
- Generated validation guidance includes the new query/write boundary rule.
- Graphify check passes after rebuild.

**Verification:**
- `bun run graphify:rebuild`
- `git diff --check`

---

## System-Wide Impact

- **Runtime behavior:** Terminal recovery listing remains read-only and avoids production query-context write crashes.
- **Type safety:** Query code can no longer accidentally receive terminal recovery write methods through the primary repository factory.
- **Validation:** `pr:athena` gains a changed-file guard for the broader query/write-boundary class.
- **Operations:** No persistent data migration and no schema changes.
- **API contracts:** Public Convex queries remain thin read boundaries; mutation behavior stays behind mutation handlers.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Harness false positives on legitimate read helpers using `QueryCtx | MutationCtx` | Flag only changed files that combine mixed ctx with mutation casts or mutation-only DB calls. |
| Static detection misses a renamed write helper | Type-level read/write split covers the immediate incident path; future deeper AST work can improve coverage if needed. |
| Public query tests over-mock repository wiring | Add repository tests using query-shaped db objects and keep service tests focused on no-patch listing semantics. |
| Generated docs drift | Update registry and run the documented generator plus Graphify rebuild before final validation. |
| Existing root checkout dirt is disturbed | Continue work in the existing hotfix worktree and use stash/fast-forward-safe root alignment only after merge. |

---

## Validation Plan

Run focused sensors first:

- `bun test scripts/harness-inferential-review.test.ts`
- `bun run harness:inferential-review`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/terminalRecovery/terminalCommandService.test.ts convex/pos/infrastructure/repositories/terminalRecoveryRepository.test.ts convex/pos/public/terminals.test.ts`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `git diff --check`

Then run merge-grade sensors:

- `bun run graphify:rebuild`
- `bun run pr:athena`

---

## Tracking Plan

Create atomic Linear issues for:

- Terminal recovery read/write repository split and regression tests.
- Inferential-review query write-boundary guard and harness tests.
- Generated validation guidance, solution learning, Graphify rebuild, and final integration validation.

The issues should be dependency-linked in that order, with the implementation allowed to land as one coordinated PR because the guard and refactor validate the same production incident class.
