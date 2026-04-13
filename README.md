# athena

## Harness

This repo uses a docs-first agent harness for `packages/athena-webapp` and `packages/storefront-webapp`.

Key repo-level commands:

- `bun run harness:test`
- `bun run harness:check`
- `bun run harness:audit`
- `bun run harness:review`
- `bun run harness:inferential-review`
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review`
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review --persist-history`
- `bun run harness:scorecard`
- `bun run harness:janitor`
- `bun run harness:self-review --base origin/main`
- `bun run harness:behavior --scenario <name>`
- `bun run harness:behavior --scenario <name> --record-video`
- `cat <behavior-log-file> | bun run harness:runtime-trends`
- `cat <behavior-log-file> | bun run harness:runtime-trends --persist-history`
- `bun run architecture:check`
- `bun run pre-push:review`
- `bun run pr:athena`
- `bun run graphify:check`

`bun run harness:test` is the canonical harness implementation gate for harness scripts, graphify tooling, and pre-push review wiring.
It targets repo-root `scripts/*.test.ts` files only (excluding cloned worktree trees).
Use `bun run harness:test -- --dry-run` to print the selected files without executing tests.

List runtime behavior scenarios with `bun run harness:behavior --list`.
Bundled scenarios include:

- `sample-runtime-smoke`
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`
- `valkey-proxy-local-request-response`
- `storefront-checkout-bootstrap`
- `storefront-checkout-validation-blocker`
- `storefront-checkout-verification-recovery`

Add `--record-video` to persist browser-flow evidence under
`artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

`harness:behavior` now emits a machine-parseable per-scenario report line:

- `[harness:behavior:report] { ...json... }`

Each report includes phase durations, runtime-signal summaries, and threshold diagnostics.
Scenario thresholds are configured in `scripts/harness-behavior-scenarios.ts` via:

- `runtimeSignals[].minMatches` / `runtimeSignals[].maxMatches`
- `thresholds.latency.maxPhaseDurationMs`
- `thresholds.latency.maxTotalDurationMs`

`harness:scorecard` emits a deterministic quality artifact at:

- `artifacts/harness-scorecard/latest.json`

`harness:inferential-review` has two lanes:

- deterministic findings remain the blocking source of truth
- `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow` adds a semantic shadow lane for telemetry without changing the exit code

When `ANTHROPIC_API_KEY` is not configured, the shadow lane records a skipped status instead of failing the deterministic lane.

Use `--persist-history` when you want append-only timestamped inferential snapshots alongside the latest artifact:

- `artifacts/harness-inferential-review/latest.json`
- `artifacts/harness-inferential-review/history/<run-stamp>.json`

`harness:runtime-trends` consumes `[harness:behavior:report]` lines from stdin and
prints aggregated scenario trend telemetry (pass/fail rates, latency stats, and
runtime-signal health diagnostics).

Use `--persist-history` to keep timestamped runtime trend snapshots alongside the latest trend artifact:

- `artifacts/harness-behavior/trends/latest.json`
- `artifacts/harness-behavior/trends/history/<run-stamp>.json`

GitHub Actions wiring:

- PR CI runs `bun run harness:inferential-review` with `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow`
- scheduled and manual harness runs persist inferential history by default
- manual runs can paste `[harness:behavior:report]` lines through the workflow dispatch input to persist runtime trend history
- PR and scheduled/manual harness jobs upload inferential, runtime-trend, and scorecard artifacts for inspection

`harness:janitor` runs drift sensors in report mode by default. Add `--repair` to
apply safe automated repair steps (`harness:generate` and `graphify:rebuild`) before
re-running checks.

## Graphify

The repo keeps a graphify knowledge graph at `graphify-out/`.

Start with [the Graphify wiki index](./graphify-out/wiki/index.md) for repo-wide navigation, package landing pages, and graph hotspots.

Use [the packages agent router](./packages/AGENTS.md) plus each package's `AGENTS.md` and `docs/agent/*` docs as the operational source of truth for edits and validation.

Use `bun run graphify:check` as the non-mutating freshness gate for tracked graphify artifacts.

Use `bun run graphify:rebuild` as the repair path when the check reports stale artifacts. The rebuild command uses the interpreter recorded in `.graphify_python` (default `python3` in this repo).

If you need to repair the local graphify setup, make sure `python3` can import `graphify` and upgrade it with `python3 -m pip install --upgrade graphifyy`.

Tracked graphify artifacts:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/*.md`

Local-only graphify artifacts:

- `graphify-out/cache/`

`graphify-out/cache/` is intentionally ignored because it is a large local acceleration cache, not a reviewable source artifact.
