# Inferential Shadow-Mode Semantic Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic shadow-mode lane to inferential review, persist inferential and runtime trend history, and surface the new telemetry in scorecards and CI without changing current merge semantics.

**Architecture:** Keep `scripts/harness-inferential-review.ts` as the single entrypoint, but split it into deterministic and semantic lanes with a combined artifact model. Extend the artifact consumers in `scripts/harness-scorecard.ts` and `scripts/harness-runtime-trends.ts` to understand history snapshots, then wire the new mode into GitHub Actions and docs.

**Tech Stack:** Bun, TypeScript, Vitest, GitHub Actions YAML, repo-local JSON artifacts

---

## File Structure

- Modify: `scripts/harness-inferential-review.ts` - add lane coordination, semantic shadow mode, history persistence, and CLI config parsing.
- Modify: `scripts/harness-inferential-review.test.ts` - cover dual-lane artifacts, shadow-mode failure handling, and history writes.
- Modify: `scripts/harness-runtime-trends.ts` - add latest-plus-history persistence helpers and CI metadata support.
- Modify: `scripts/harness-runtime-trends.test.ts` - cover history snapshot writing and malformed-input handling.
- Modify: `scripts/harness-scorecard.ts` - surface semantic lane status, inferential/trend history presence, and provider error rollups.
- Modify: `.github/workflows/athena-pr-tests.yml` - wire semantic shadow mode for PRs and persistence for scheduled/manual runs.
- Modify: `README.md` - document semantic shadow mode and history locations.

### Task 1: Inferential coordinator and semantic shadow mode

**Files:**
- Modify: `scripts/harness-inferential-review.ts`
- Test: `scripts/harness-inferential-review.test.ts`

- [ ] Write failing tests for dual-lane artifacts and shadow-mode provider failures.
- [ ] Run `bun test scripts/harness-inferential-review.test.ts` and confirm the new assertions fail first.
- [ ] Implement deterministic and semantic lanes with one combined inferential artifact.
- [ ] Preserve deterministic blocking semantics while recording semantic-lane findings and errors in shadow mode.
- [ ] Re-run the inferential-review test file and commit the passing change.

### Task 2: History persistence and scorecard surfacing

**Files:**
- Modify: `scripts/harness-inferential-review.ts`
- Modify: `scripts/harness-runtime-trends.ts`
- Modify: `scripts/harness-scorecard.ts`
- Test: `scripts/harness-inferential-review.test.ts`
- Test: `scripts/harness-runtime-trends.test.ts`
- Test: `scripts/harness-scorecard.test.ts`

- [ ] Add failing tests for inferential history snapshots, runtime trend history snapshots, and scorecard history rollups.
- [ ] Implement latest-plus-history persistence helpers with deterministic timestamped filenames.
- [ ] Extend scorecard metrics to summarize inferential history presence, runtime trend history presence, and semantic-lane provider health.
- [ ] Re-run the focused test files and commit the passing change.

### Task 3: CI wiring and documentation

**Files:**
- Modify: `.github/workflows/athena-pr-tests.yml`
- Modify: `README.md`
- Modify: `scripts/harness-scorecard.test.ts` or other affected fixtures if expectations change.

- [ ] Add or update tests/fixtures that assert shadow-mode env wiring and persisted history paths.
- [ ] Update CI to run inferential review in semantic shadow mode and persist history on scheduled/manual runs.
- [ ] Update repo docs to explain semantic shadow mode, persistence controls, and artifact locations.
- [ ] Run repo validation: `bun run harness:test`, `bun run harness:check`, `bun run harness:audit`, `bun run harness:inferential-review`, `bun run harness:scorecard`, `bun run graphify:rebuild`, `bun run graphify:check`, and `bun run pr:athena`.
- [ ] Commit the validated CI/docs changes.
