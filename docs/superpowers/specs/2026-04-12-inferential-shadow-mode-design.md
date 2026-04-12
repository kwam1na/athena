# Inferential Shadow-Mode Semantic Review Design

## Goal

Upgrade Athena's inferential harness from a deterministic-only policy gate to a dual-sensor review flow that adds a true semantic reviewer in shadow mode, persists run history for both inferential and runtime trend signals, and surfaces the new telemetry in scorecards without making merges depend on the new semantic path yet.

## Why

The current `harness:inferential-review` command is useful, but its "inferential" layer is still deterministic policy. That means it is good at catching known wiring regressions, but weak at judging semantic drift, incomplete docs, or inconsistent harness changes. At the same time, `harness:runtime-trends` and `harness:scorecard` only reflect the latest artifact, so we cannot measure whether new signals are stable enough to trust. Shadow mode closes both gaps safely: it adds semantic signal collection now and gives us history to evaluate precision before we ever let it block.

## Non-Goals

- Do not make semantic findings block PRs in this phase.
- Do not introduce a network-required merge gate for local development.
- Do not replace the current deterministic checks or relax any existing blocking safety policy.
- Do not build an external telemetry service; persistence should use repo-local artifacts and CI-managed history first.

## Architecture

### 1. Inferential coordinator

`harness:inferential-review` remains the single command entrypoint and becomes a coordinator with two review lanes:

- `deterministic`: the current merge-gating review lane
- `semantic`: a richer review lane that emits structured findings in shadow mode

The coordinator will:

- discover changed files and target harness-critical files
- run deterministic review exactly as today
- attempt semantic review when configuration enables it
- downgrade semantic provider/runtime failures into shadow-mode artifact errors instead of process failure
- write one combined machine artifact with lane-specific results and an overall summary
- exit non-zero only for deterministic failures or fatal command-integrity failures

### 2. Semantic provider contract

Introduce a provider abstraction for semantic review so the harness can support multiple implementations without changing the command contract.

Provider contract requirements:

- input: repo root, base ref, changed files, target files, and selected file contents
- output: provider name, review mode, structured findings, optional observations, and provider/runtime errors
- deterministic JSON shape suitable for tests and scorecards

The first semantic implementation should be a real semantic reviewer, but it must be gated by explicit configuration. The harness should support these modes:

- `off`: skip semantic review entirely
- `shadow`: run semantic review and record findings, but never fail the command from semantic findings

For this phase, `shadow` is the only CI mode we enable.

### 3. Machine artifact model

Replace the current single-lane inferential artifact with a combined artifact that preserves backward-compatible high-level fields while adding lane detail.

Artifact additions:

- `reviewMode`: `deterministic-only` or `semantic-shadow`
- `lanes.deterministic`: status, findings, errors, provider name, summary
- `lanes.semantic`: status, findings, errors, provider name, summary, execution mode
- `summaryCounts`: finding/error counts per lane and total
- `historyKey`: stable key used by history persistence

Backward-compatible top-level fields such as `status`, `summary`, `changedFiles`, and `targetFiles` remain so existing tools do not break.

### 4. History persistence

Persist append-only history snapshots for:

- inferential review runs
- runtime trend aggregations

History locations:

- `artifacts/harness-inferential-review/history/*.json`
- `artifacts/harness-behavior/trends/history/*.json`
- stable latest pointers remain at:
  - `artifacts/harness-inferential-review/latest.json`
  - `artifacts/harness-behavior/trends/latest.json`

Each history snapshot should include:

- `generatedAt`
- source command/version
- CI context when available (`event_name`, branch/ref, PR number if known)
- lane statuses
- compact summary counts

History writing rules:

- local runs can write `latest.json` only by default
- explicit persistence mode writes both `latest.json` and a timestamped history snapshot
- CI scheduled and manual harness runs should use persistence mode
- PR runs can stay latest-only unless we intentionally opt into denser history later

### 5. Scorecard and trend surfacing

`harness:scorecard` should evolve from "latest artifact present" into "latest artifact plus recent trend quality".

Add scorecard metrics for:

- semantic lane presence/status/provider
- shadow-mode finding counts vs deterministic counts
- whether inferential history exists and how many recent samples are available
- whether runtime trend history exists and how many recent samples are available
- recent semantic provider error rate over the retained history window

The scorecard summary should remain deterministic and easy to gate on. In this phase it should never degrade the repo solely because the semantic lane found issues; it should degrade only on missing artifacts, repeated provider/runtime errors, or obviously broken persistence.

### 6. CI integration

Keep the PR workflow safe and incremental:

- PR validation: run inferential review in semantic shadow mode, write latest artifact, generate scorecard
- scheduled and manual harness jobs: run inferential review in semantic shadow mode and persist history snapshots
- runtime trend history: add a scheduled/manual path that consumes harness behavior report logs when available and persists latest plus history snapshot

This phase does not require uploading artifacts to an external system. GitHub Actions artifacts are optional for debugging, not required for the design to work.

## Components

### `scripts/harness-inferential-review.ts`

Refactor into clear units:

- changed-file discovery
- target-file selection
- deterministic lane
- semantic lane
- combined artifact builder
- history persistence helpers
- CLI environment/config parsing

### `scripts/harness-runtime-trends.ts`

Add a persistence helper that can write latest and optional history snapshots with metadata, without changing the existing stdin-driven aggregation contract.

### `scripts/harness-scorecard.ts`

Extend inferential and trend inspection to read:

- latest inferential artifact
- optional inferential history directory
- optional runtime trend latest/history artifacts

Surface recent-history rollups without requiring any network call.

### `.github/workflows/athena-pr-tests.yml`

Add explicit environment wiring for semantic shadow mode and history-persisting scheduled/manual runs.

### `README.md`

Document:

- semantic shadow mode behavior
- any required env vars for enabling the provider
- how history persistence works locally vs CI
- where to inspect scorecard/history outputs

## Data Flow

### PR flow

1. `harness:inferential-review` discovers harness-critical files.
2. Deterministic lane evaluates the diff and remains blocking.
3. Semantic lane runs in shadow mode when configured.
4. Combined artifact is written to `artifacts/harness-inferential-review/latest.json`.
5. `harness:scorecard` reads the latest inferential artifact plus any existing history and emits repo health.
6. PR succeeds or fails based on existing blocking rules, not semantic findings.

### Scheduled/manual flow

1. CI runs inferential review in semantic shadow mode with persistence enabled.
2. Combined inferential artifact is written to `latest.json` and a timestamped history snapshot.
3. Runtime trend aggregation, when available, writes `latest.json` and a timestamped history snapshot.
4. Scorecard summarizes the latest state and recent-history stability.
5. Humans review history to decide when semantic review is reliable enough for future tightening.

## Error Handling

- Deterministic lane failures remain blocking and exit non-zero.
- Semantic provider failures in shadow mode are captured as semantic-lane errors and reflected in the scorecard/history, but they do not fail the command.
- Invalid persisted history files should be ignored with explicit parse-error accounting rather than crashing the scorecard.
- If the coordinator cannot write the latest artifact at all, the command should fail because the harness contract is broken.
- If history persistence is requested and the history snapshot write fails, the command should fail in CI-oriented persistence mode because the requested telemetry was not produced.

## Testing Strategy

### Unit and implementation tests

Add or update deterministic tests for:

- semantic shadow-mode artifacts when both lanes run
- semantic provider failure in shadow mode staying non-blocking while being recorded
- deterministic findings remaining blocking even when semantic lane passes
- history snapshot writing for inferential artifacts
- history snapshot writing for runtime trend artifacts
- scorecard behavior with no history, healthy history, malformed history, and repeated semantic provider errors

### Integration validation

Run at least:

- `bun run harness:test`
- `bun run harness:check`
- `bun run harness:audit`
- `bun run harness:inferential-review`
- `bun run harness:scorecard`
- `bun run graphify:rebuild`
- `bun run graphify:check`
- `bun run pr:athena`

## Ticket Split

### Ticket A: inferential semantic shadow-mode coordinator

Scope:

- add lane abstraction and semantic shadow-mode execution
- evolve inferential artifact schema while preserving top-level compatibility
- add inferential tests for lane behavior and shadow-mode failures

Acceptance signal:

- `harness:inferential-review` can run deterministic-only or semantic shadow mode and emits a combined artifact

### Ticket B: history persistence and scorecard trend surfacing

Scope:

- add inferential history persistence helpers
- add runtime trend history persistence helpers
- extend scorecard to summarize recent inferential/trend history and semantic-lane health
- document the new telemetry model

Acceptance signal:

- scheduled/manual harness runs can persist history snapshots and the scorecard reports recent history presence and semantic health

### Ticket C: CI wiring and validation hardening

Scope:

- wire semantic shadow-mode env/config into GitHub Actions
- persist history on scheduled/manual jobs
- update tests or fixtures affected by workflow and documentation changes

Acceptance signal:

- CI runs the semantic lane in shadow mode without changing PR merge semantics, and scheduled/manual runs persist telemetry history

Dependencies:

- Ticket B depends on Ticket A's artifact schema
- Ticket C depends on Ticket A and Ticket B for stable command/paths

## Rollout

Phase 1 in this design is complete when:

- semantic review runs in shadow mode in CI
- deterministic review remains the only blocking inferential lane
- inferential and runtime trend history can be persisted on schedule/manual runs
- scorecard shows whether the semantic lane is healthy enough to trust

A later phase can decide whether to tighten the semantic lane into a blocking signal once the retained history shows acceptable stability and usefulness.
