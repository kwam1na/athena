---
title: Refactor PR Athena Proof Ladder
type: refactor
status: active
date: 2026-06-13
---

# Refactor PR Athena Proof Ladder

## Summary

Split the Athena PR gate into explicit prepare, validate, and proof-recording commands so agents validate the exact tree they intend to commit. Add a preparation guard that refreshes generated artifacts, stages tracked changes only, and blocks before the heavy ladder if unstaged or untracked files would make the proof non-reusable.

---

## Problem Frame

Recent delivery sessions showed `bun run pr:athena` can pass the heavy validation ladder while intended new files remain untracked. Because proof recording refuses mixed unstaged or untracked states, the later `git push` falls through to the full pre-push suite and repeats the same expensive checks.

---

## Requirements

- R1. `pr:athena` remains the safe default command and still runs generated-artifact preparation, the full validation ladder, and proof recording.
- R2. The validation ladder can be invoked independently as `pr:athena:validate` without preparation or proof recording.
- R3. Proof recording can be invoked independently as `pr:athena:record-proof`.
- R4. A new preparation command refreshes generated artifacts and blocks before heavy validation if unstaged or untracked files remain.
- R5. The preparation command stages tracked changes only and never auto-stages arbitrary untracked files.
- R6. Pre-push proof reuse remains fail-closed and continues to reject stale, dirty, or mismatched trees.
- R7. Harness docs, script tests, and solution notes reflect the new validation ladder so future agents use it correctly.

---

## Scope Boundaries

- Do not weaken `pre-push:review` proof evaluation or make it heuristic-based.
- Do not bypass pre-push validation when no current proof exists.
- Do not auto-stage untracked feature files; the tool should list them and make the operator or agent stage the intended set explicitly.
- Do not change package-level test selection, CI workflow semantics, or GitHub required checks beyond script-name/docs alignment.

---

## Context & Research

### Relevant Code and Patterns

- `package.json` owns the root command wiring for `pre-push:review` and `pr:athena`.
- `scripts/pre-commit-generated-artifacts.ts` already refreshes harness docs, Convex generated API files, graphify artifacts, and stages tracked changes with `git add --update -- .`.
- `scripts/pre-push-validation-proof.ts` owns proof recording and reuse evaluation. It already supports staged-index proof recording when the worktree has no unstaged or untracked files.
- `scripts/pre-push-validation-proof.test.ts` covers clean proof reuse, staged-index proof reuse after commit, rejection of untracked files, and stale proof reasons.
- `scripts/pre-push-review.ts` consumes proof evaluation before running expensive pre-push validation.
- `docs/harness.md` documents generated-artifact repair, `pr:athena`, and pre-push proof reuse.
- `README.md` also summarizes the Athena PR gate and may need wording updates alongside `docs/harness.md`.

### Institutional Learnings

- `docs/solutions/harness/generated-artifact-repair-full-tracked-diff-2026-05-02.md`: generated repair should stage the full tracked diff with `git add --update -- .`, not `git add .` or `git add -A`.
- `docs/solutions/harness/repo-validation-rerun-policy-2026-05-07.md`: rerun avoidance must remain proof-based and fail closed when any proof input is stale or dirty.
- `docs/solutions/harness/compound-solution-gate-2026-05-05.md`: validation-gate changes should carry durable solution documentation.

### External References

- None. This is repo-local harness behavior with strong existing patterns.

---

## Key Technical Decisions

- Split command ownership without changing the default gate: `pr:athena` should compose preparation, validation, and proof recording so existing usage stays safe.
- Put the mixed-tree guard in a repo harness script rather than shell-only package JSON: this keeps behavior testable and lets diagnostics list the blocking paths.
- Keep untracked handling manual: the prepare command should explain which files must be staged or removed, not decide whether new files belong in the commit.
- Preserve staged-index proof semantics: after preparation and explicit staging, the proof may describe the index tree that the next commit will contain.

---

## Open Questions

### Resolved During Planning

- Should untracked files be auto-staged by prepare? No. Existing generated-artifact staging intentionally stages tracked files only to avoid pulling unrelated local files into commits.
- Should pre-push reuse become less strict? No. Reuse remains proof-based and fail-closed.

### Deferred to Implementation

- Exact CLI diagnostic wording: choose concise operator-facing wording while implementing and lock it with tests.
- Whether the helper lives in a new script or extends `pre-push-validation-proof.ts`: pick the smallest testable shape once implementation starts.

---

## Implementation Units

- U1. **Split Commands And Add Prepare Guard**

**Goal:** Add explicit `pr:athena:prepare`, `pr:athena:validate`, and `pr:athena:record-proof` commands while keeping `pr:athena` as the composed safe default.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** None

**Files:**

- Modify: `package.json`
- Modify or create: `scripts/pre-push-validation-proof.ts`
- Modify or create: `scripts/pr-athena-prepare.ts`
- Test: `scripts/pre-push-validation-proof.test.ts`
- Test if new script is created: `scripts/pr-athena-prepare.test.ts`

**Approach:**

- Extract the current heavy command body into `pr:athena:validate`.
- Add `pr:athena:record-proof` as a direct wrapper around existing proof recording.
- Add `pr:athena:prepare` before validation. It should run the existing generated-artifact repair flow, then inspect git status for unstaged or untracked residue.
- Block with actionable diagnostics when residue remains, making clear that intended new files must be staged explicitly before running the heavy ladder.
- Keep `pr:athena` as `prepare && validate && record-proof`.

**Execution note:** Test-first. Start with failing harness-script tests for clean, staged-only, unstaged, and untracked states before changing command wiring.

**Patterns to follow:**

- `scripts/pre-commit-generated-artifacts.ts` for tracked-only staging.
- `scripts/pre-push-validation-proof.ts` for git status inspection and proof diagnostics.
- `scripts/pre-push-review.test.ts` for command orchestration tests with stubbed runners.

**Test scenarios:**

- Happy path: clean tree after generated-artifact repair lets `pr:athena:prepare` pass.
- Happy path: tracked modified files are staged by generated-artifact repair and prepare passes when no untracked files remain.
- Edge case: staged-only tree passes prepare so later proof can record the staged index.
- Error path: unstaged tracked residue after repair blocks before validation and lists the file.
- Error path: untracked residue blocks before validation and lists the file without staging it.
- Integration: `package.json` exposes `pr:athena:prepare`, `pr:athena:validate`, `pr:athena:record-proof`, and keeps `pr:athena` composed in the expected order.

**Verification:**

- Script tests prove the mixed-tree guard fires before the heavy ladder.
- Existing proof tests still pass, including staged-index proof reuse and dirty-tree rejection.
- `pr:athena` still ends by recording proof only after the validation ladder succeeds.

---

- U2. **Refresh Harness Documentation And Durable Learning**

**Goal:** Update repo guidance so future agents run the split commands correctly and understand why prepare blocks on untracked files.

**Requirements:** R7

**Dependencies:** U1

**Files:**

- Modify: `docs/harness.md`
- Modify: `README.md`
- Modify if docs wording assertions change: `scripts/pre-push-review.test.ts`
- Create or modify: `docs/solutions/harness/pr-athena-prepare-validate-proof-2026-06-13.md`
- Modify if generated docs change: `graphify-out/GRAPH_REPORT.md`
- Modify if generated docs change: `graphify-out/graph.json`
- Modify if generated docs change: `graphify-out/wiki/index.md`

**Approach:**

- Update `docs/harness.md` and `README.md` with the new command split and the expected delivery sequence.
- Add a solution note that captures the session-discovered failure mode: heavy validation can be wasted when untracked files prevent proof recording.
- Rebuild graphify after code/docs edits per repo instructions.

**Execution note:** Sensor-only for docs and generated graph artifacts; behavior is covered by U1 tests.

**Patterns to follow:**

- `docs/solutions/harness/repo-validation-rerun-policy-2026-05-07.md`
- `docs/solutions/harness/generated-artifact-repair-full-tracked-diff-2026-05-02.md`

**Test scenarios:**

- Test expectation: none for prose docs and graph artifacts. The relevant proof behavior is covered in U1.

**Verification:**

- Documentation names the split commands and the staged/untracked contract.
- Existing docs assertions still reflect the command names and proof contract.
- Graphify artifacts are current.
- The full repo gate can reuse proof on push when the branch commit matches the validated tree.

---

## System-Wide Impact

- **Interaction graph:** Root package scripts, generated-artifact repair, proof recording, and pre-push proof reuse become a more explicit ladder.
- **Error propagation:** Prepare failures should exit non-zero with actionable diagnostics before expensive validation starts.
- **State lifecycle risks:** The proof file remains git-private and worktree-local; no tracked proof state is introduced.
- **API surface parity:** This changes root CLI script names only; no runtime app API changes.
- **Integration coverage:** Package-script wiring plus proof/prepare tests are required because shell composition mistakes would otherwise be hard to see.
- **Unchanged invariants:** Pre-push stays fail-closed, generated repair stages tracked files only, and untracked files are never auto-staged.

---

## Risks & Dependencies

| Risk                                                                                     | Mitigation                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prepare blocks legitimate workflows that intentionally validate before staging new files | Make diagnostics clear and keep `pr:athena:validate` available for advanced manual validation without proof assumptions. |
| Command split drifts from docs                                                           | Update `docs/harness.md`, add tests around package script wiring, and add a solution note.                               |
| Proof reuse becomes too permissive                                                       | Do not change pre-push evaluation semantics; only tighten when proof recording happens.                                  |

---

## Documentation / Operational Notes

- Linear tickets should be executed as a coordinated batch because the code, docs, and graphify artifacts all touch shared repo-generated state.
- The final branch should run focused script tests first, then the repo PR gate after the intended tree is staged.

---

## Sources & References

- Related code: `package.json`
- Related code: `scripts/pre-commit-generated-artifacts.ts`
- Related code: `scripts/pre-push-validation-proof.ts`
- Related code: `scripts/pre-push-review.ts`
- Related docs: `docs/harness.md`
- Related learning: `docs/solutions/harness/generated-artifact-repair-full-tracked-diff-2026-05-02.md`
- Related learning: `docs/solutions/harness/repo-validation-rerun-policy-2026-05-07.md`
