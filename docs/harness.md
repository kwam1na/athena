# Repo Harness And Sensors

## High-Level Overview

The repo harness is Athena's delivery safety system. It is not one test suite or
one CI job. It is a collection of sensors that keep the repo understandable,
reviewable, and difficult to accidentally drift out of shape.

It works like an operating checklist for the codebase: it keeps maps up to
date, checks that important workflows still have tests, exercises representative
runtime paths, and stops a change when the evidence is incomplete.

Under the hood, the harness is implemented as Bun scripts, package-local
generated docs, graphify artifacts, Git hooks, and GitHub Actions jobs. Most
repo-level commands are defined in `package.json`, backed by scripts under
`scripts/`, and targeted through the package registry in
`scripts/harness-app-registry.ts`.

The main idea is simple:

1. Code and product surfaces are registered.
2. The registry generates navigation and validation docs.
3. Sensors compare the registered expectations against the live repo.
4. Review commands compare a branch against `origin/main`.
5. Repair commands refresh generated artifacts, then stop so people can review
   and commit the repaired files intentionally.

## What The Harness Protects

The harness protects four kinds of trust.

- **Navigation trust:** agents and humans need a reliable map of packages,
  routes, entry points, tests, key folders, and validation commands.
- **Validation trust:** each important surface should point to the checks that
  prove it still works.
- **Review trust:** a branch should not merge with stale generated docs, missing
  sibling tests, broken architecture boundaries, or unreviewed harness changes.
- **Runtime trust:** representative user and system flows should still boot,
  emit expected signals, and stay within basic health thresholds.

This is why Athena treats generated docs and graph artifacts as reviewable
source artifacts. They are not decorative output. They are part of how future
agents and maintainers understand the current repo.

## Core Pieces

### Registry

`scripts/harness-app-registry.ts` is the main source of truth for harnessed
packages. It lists package names, important folders, generated doc paths, and
validation scenarios.

The registry currently describes active package surfaces such as:

- `packages/athena-webapp`
- `packages/storefront-webapp`
- `packages/valkey-proxy-server`

When a package gains a new important surface, the registry is usually where the
harness learns that the surface exists and what should validate it.

### Generated Agent Docs

Each harnessed package has `docs/agent/*` files and an `AGENTS.md` file. Some
are hand-authored orientation docs. Others are generated from the registry and
live filesystem.

The generated docs answer questions like:

- What routes or service entry points exist?
- Which folders matter most?
- Which tests exist?
- Which commands validate a touched area?

`bun run harness:generate` refreshes those generated docs.
`bun run harness:check` verifies that required docs, links, generated files, and
validation maps are present and fresh.

### Graphify

Graphify builds a repo knowledge graph under `graphify-out/`. It gives agents a
fast way to orient around communities, package pages, and code relationships
before reading raw files.

Tracked graphify outputs include:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/*.md`

`bun run graphify:rebuild` refreshes the graph.
`bun run graphify:check` verifies tracked graphify artifacts are current.

### Git Hooks And CI

Local Git hooks are tracked under `.husky/`. The important path is the pre-push
hook, which runs `bun run pre-push:review`.

GitHub Actions runs the repo harness in `.github/workflows/athena-pr-tests.yml`.
CI repeats the important sensors so local success and remote review stay aligned.

## What The Sensors Do

### Freshness Sensors

Freshness sensors catch stale generated artifacts.

- `harness:check` verifies generated harness docs and package validation maps.
- `graphify:check` verifies tracked graphify outputs.
- `pre-commit:generated-artifacts` runs `harness:generate` and
  `graphify:rebuild`, then stages tracked source changes and generated outputs.
- `pre-push:review` can attempt a narrow repair once, then blocks so the repaired
  files are reviewed and committed before push.
- `pr:athena:prepare` runs generated-artifact repair, stages tracked changes
  only, then blocks before heavy validation if unstaged or untracked files would
  prevent reusable proof recording.
- `pr:athena` runs the delivery-run wrapper, which records local run metrics for
  the prepare, validate, record-proof, and scorecard phases. It writes same-tree
  provider evidence only after provider commands pass, then runs the scorecard
  against the current delivery-run ledger.
- `pr:athena:validate` runs the heavy local PR ladder without recording proof.
- `pr:athena:record-proof` records a git-private proof only when the branch
  head or staged index, `origin/main`, validation wiring, Bun version, and
  working tree state can be reused safely. A later `pre-push:review` may reuse
  that proof instead of rerunning the whole local suite.

The important behavior is fail-closed repair. The harness may refresh files, but
it does not silently push repaired evidence past review.

### Compound Sensors

`bun run compound:check` keeps considerable delivery work connected to
`docs/solutions/`. It blocks changed markdown that references a missing
`docs/solutions/**/*.md` file, and it blocks substantial source changes unless
the branch also changes a solution note.

This is a delivery guardrail, not a documentation quota. Small source edits,
test-only changes, generated artifacts, and docs-only changes can pass without a
new solution note. Large behavior-bearing changes need durable compounding while
the context is still fresh.

The sensor also treats workflow-critical files as compound-sensitive even when
the line count is small. Changes to repo harness scripts, PR validation wiring,
GitHub workflows, Husky hooks, package-level command wiring, or the core
delivery skills need a solution note because those paths affect how future
agents deliver work. Use the repo-local `.agents/skills/ce-compound` skill and
template to author those notes; changed solution notes must include the expected
frontmatter and the `Problem`, `Solution`, and `Prevention` sections, and
placeholder notes do not satisfy the gate.

Foundational architecture solution notes also need an agent-doc discovery link.
If a solution note is an architecture foundation, primitive, aggregate, contract,
policy, or architecture pattern, link it from the relevant
`packages/*/docs/agent/{architecture.md,code-map.md,testing.md}` surface so a
future agent can find the durable concept before editing the boundary.

### Coverage Sensors

`bun run test:coverage` is the repo coverage gate. It first repairs missing or
stale Vitest-family installs with `bun install --frozen-lockfile` when manifest
versions are already correct, then runs package coverage and root script
coverage before aggregating the current checkout's LCOV reports.

The current policy is a baseline ratchet: covered surfaces may not regress below
the characterized baseline, while the long-term target remains full coverage.
That makes coverage useful now without blocking all delivery until the repo is
perfectly covered.

### Architecture Sensors

`bun run architecture:check` runs repo architecture boundary checks. These guard
against code crossing boundaries the repo has chosen to keep explicit, such as
browser/server separation and other package-level constraints.

The architecture sensor is intentionally mechanical. It catches repeatable
boundary mistakes before a human review has to rediscover them.

### Convex Sensors

Athena's webapp has Convex-specific audit and lint commands, including
`audit:convex` and `lint:convex:changed`. These catch backend patterns that are
easy to miss during feature work, such as unsafe query patterns or drift in
Convex-facing contracts.

The root `pr:athena` command includes these checks because Convex is part of the
product's runtime contract, not a separate optional backend.

### Harness Implementation Sensors

`bun run harness:test` runs the implementation tests for repo harness scripts
under `scripts/*.test.ts`. These tests protect the harness itself: registry
logic, generated-doc checks, pre-push behavior, graphify tooling, behavior
scenarios, coverage summary logic, and related script contracts.

When the harness changes, this command is the first proof that the sensors still
work.

### Review Sensors

`bun run harness:self-review --base origin/main` and
`bun run harness:review --base origin/main` compare a branch against the base
branch and look for validation gaps.

These commands reason about changed files and validation maps. If a change
touches a registered surface, the harness can point to the commands or behavior
scenarios that should prove the change.

Repo-owned harness surfaces are handled separately from package validation maps.
Changes under `scripts/`, package `docs/agent` guidance, package `AGENTS.md`,
top-level repo wiring, GitHub workflows, Husky hooks, and `README.md` select the
repo validation command set: `harness:test`, `delivery:documentation-check`, `test:coverage`,
and `harness:inferential-review`.

Standalone `harness:review` runs that repo validation command set when those
files change. Inside `pr:athena`, the same commands have already run directly,
so `pr:athena` calls `harness:review` with an explicit parent-provider flag and
`harness:review` reports that the repo validation commands were already
provided. That removes duplicate expensive work without weakening standalone
review or pre-push behavior.

`bun run harness:inferential-review` adds a higher-level review pass. Its
deterministic lane is blocking. Its semantic shadow mode can collect extra
review telemetry without changing the merge decision.

### Runtime Behavior Sensors

`bun run harness:behavior --scenario <name>` runs named runtime scenarios from
`scripts/harness-behavior-scenarios.ts`. Scenarios cover representative flows
such as app shell boot, storefront backend loading, checkout paths, and service
runtime checks.

Each behavior run emits a machine-readable report line:

```text
[harness:behavior:report] { ...json... }
```

Those reports include phase durations, runtime signal matches, and threshold
diagnostics. Optional video recording writes local evidence under
`artifacts/harness-behavior/videos/`.

`bun run harness:runtime-trends` can aggregate those report lines into trend
artifacts so recurring runtime signals are visible over time.

### Scorecard And Janitor Sensors

`bun run harness:scorecard` reads harness artifacts and emits a deterministic
quality snapshot at `artifacts/harness-scorecard/latest.json`.

`bun run harness:janitor` reports drift across generated docs and graphify
artifacts. With `--repair`, it applies safe repairs such as `harness:generate`
and `graphify:rebuild`, then reruns checks.

These sensors are useful for scheduled maintenance because they summarize repo
health without requiring someone to inspect every raw artifact.

## How The Commands Fit Together

For everyday feature work, the narrow package tests still matter. The harness
does not replace focused tests. It adds repo-level sensors around them.

For merge-ready Athena work, the broad command is:

```sh
bun run pr:athena
```

That command runs the delivery-run wrapper, which records local run metrics while
composing explicit phases:

```sh
bun run pr:athena:prepare
bun run pr:athena:preflight
bun run pr:athena:validate
bun run pr:athena:record-proof
bun run pr:athena:scorecard
```

`pr:athena:prepare` repairs generated artifacts and stages tracked changes, then
stops before the heavy ladder if unstaged or untracked files remain. It does not
stage new files automatically; stage intended new files explicitly and rerun the
prepare step before spending the full validation cycle.

`pr:athena:preflight` then aggregates validation-map coverage, live harness
audit, audit-fixture consistency, and harness-script sibling-test policy before
provider validation starts. Its failure report names the registry source,
generated-doc repair, fixture and sibling-test files, and the focused
verification command, so a preflight failure is actionable without reading the
sensor source.

`pr:athena:validate` runs the main repo ladder in two halves. The provider half
runs Convex audits, architecture checks, and coverage; if those commands pass,
the gate writes same-tree provider evidence. The review half then runs harness
review, inferential review, audit, and graphify freshness. `pr:athena:scorecard`
runs after proof recording so it reads the current delivery-run ledger.

After the final `graphify:check`, `pr:athena:record-proof` records a
worktree-local proof for the current clean tree or staged index and
`origin/main`. `pre-push:review` reuses that proof only when the pushed tree,
base SHA, clean working tree, Bun version, `pr:athena` script, and validation
wiring fingerprint still match. Any dirty file, generated-artifact repair,
rebase, advanced `origin/main`, changed hook, changed harness script, or missing
proof makes pre-push run the full validation suite normally and prints the
reason. If `origin/main` or the base diff cannot be read, the hook blocks
instead of treating the changed-file set as empty.

The reusable proof is local-only git metadata, not a source artifact and not a
remote CI substitute. Proof evaluation emits a structured status for local
handoff and run-metrics ledgers: `reusable`, `missing`, `dirty`, `stale`,
`base_changed`, `validation_wiring_changed`, `generated_repaired`, and
`proof_not_recorded`, plus `source_registry_drift` for source-registry drift
sensors when that drift is the modeled cause. The provider/ledger plumbing
records what the local sensor observed; it does not make the proof portable
across worktrees, machines, or a changed `origin/main`.

For harness-only changes, useful focused commands are:

```sh
bun run harness:test
bun run harness:check
bun run harness:review --base origin/main
bun run harness:inferential-review
bun run graphify:check
```

The Athena PR workflow may run `harness:review` with
`--validation-provided-by athena-pr-tests`. That CI-only mode still checks the
validation maps and selected runtime behavior scenarios, but it skips package
test/build/lint commands already enforced elsewhere in the same workflow. Keep
standalone local `harness:review --base origin/main` fail-closed so agents can
still get the full touched-surface command list outside CI.

For runtime scenario work, use:

```sh
bun run harness:behavior --list
bun run harness:behavior --scenario <name>
```

## When To Update The Harness

Update the harness when a change affects how future work should be understood or
validated.

Common examples:

- a new package becomes part of the supported product surface
- a package adds a major route, service entry point, or workflow family
- a validation command changes
- a generated doc references stale paths
- a recurring bug pattern deserves a repo-level guardrail
- a runtime flow should become a named behavior scenario
- graphify output is stale after code or documentation changes

When in doubt, keep the source of truth close to the sensor:

- package surface and validation mapping: `scripts/harness-app-registry.ts`
- generated package docs: `bun run harness:generate`
- graph navigation: `bun run graphify:rebuild`
- repeatable bug-class guardrails: scripts under `scripts/` plus sibling tests
- package-specific validation guidance: package `AGENTS.md` and `docs/agent/*`

## How To Read A Harness Failure

Most harness failures are trying to answer one of these questions:

- Is the repo map stale?
- Did a touched surface lose its validation evidence?
- Did generated output change without being committed?
- Did a boundary rule catch an unsafe dependency or import?
- Did a runtime flow stop emitting the expected signal?
- Did the harness itself change without its sibling tests?

The fastest response is usually:

1. Read the exact failing command and message.
2. Decide whether it is a code failure, stale generated artifact, or missing
   validation mapping.
3. Run the narrow repair or validation command named by the failure.
4. Review the diff.
5. Commit the source change and its refreshed evidence together.

Avoid weakening the sensor to get past a failure. If the failure is noisy, fix
the sensor's precision with a test so the repo learns from the false positive.

Repeated validation work is noise only when a parent command has already
provided the same repo-owned command set for the same head and base, or when
`pre-push:review` prints that it reused a current `pr:athena` proof. It is not
noise when the proof is missing or stale, when the working tree is dirty, when
generated outputs were repaired, when `origin/main` advanced, or when the change
touches validation wiring. In those cases rerunning is the fail-closed policy.
The pre-push handoff line separates `validation=<passed|skipped>` from
`proof=<status>` so a successful validation rerun is not confused with proof
reuse.

## Command And Artifact Reference

This section is the lookup table for the commands and outputs described above.
The narrative sections explain why a sensor exists; this section records what to
type and where the output lands.

### Repo-Level Commands

| Command | Purpose |
| --- | --- |
| `bun run harness:generate` | Regenerate the generated agent docs from the registry and live filesystem. |
| `bun run harness:check` | Verify generated harness docs, links, and validation maps are present and fresh. |
| `bun run harness:test` | Run the harness implementation tests. |
| `bun run harness:audit` | Audit harness coverage across registered surfaces. |
| `bun run harness:self-review --base origin/main` | Deterministic branch review against the base. |
| `bun run harness:review --base origin/main` | Touched-surface validation review; fail-closed when run standalone. |
| `bun run harness:inferential-review` | Higher-level review pass; deterministic lane is blocking. |
| `bun run harness:behavior --list` | List available runtime behavior scenarios. |
| `bun run harness:behavior --scenario <name>` | Run one runtime behavior scenario. |
| `bun run harness:runtime-trends` | Aggregate `[harness:behavior:report]` lines from stdin into trend telemetry. |
| `bun run harness:scorecard` | Emit the deterministic quality snapshot. |
| `bun run harness:janitor` | Report drift; `--repair` applies safe repairs, then rechecks. |
| `bun run architecture:check` | Run architecture boundary checks. |
| `bun run compound:check` | Enforce the solution-note delivery guardrail. |
| `bun run delivery:documentation-check` | Combined solution-note and landed-change-report policy check. |
| `bun run graphify:check` | Freshness gate for tracked graphify artifacts. |
| `bun run graphify:rebuild` | Repair path for stale graphify artifacts. |
| `bun run pre-push:review` | The pre-push gate; also runnable by hand. |
| `bun run pr:athena` | The full delivery ladder (see phases below). |

`harness:test` selects `.test.ts` files from the top level of the repo-root
`scripts/` directory only. The scan is non-recursive, so nested trees — including
cloned worktrees under `worktrees/` — are never picked up. Use
`bun run harness:test -- --dry-run` to print the selected files without running
them.

The repo pins Bun through `packageManager` in `package.json` (`bun@1.1.29`
today). Every GitHub Actions job sets up Bun with `bun-version-file: package.json`,
so CI and local harness runs read the same declared version.

### Delivery Ladder Phases

`pr:athena` delegates to `pr:athena:delivery-run`, which composes:

| Phase | Command | Notes |
| --- | --- | --- |
| Prepare | `pr:athena:prepare` | Dependency check, generated-artifact repair, then blocks if unstaged or untracked files would prevent reusable proof. |
| Preflight | `pr:athena:preflight` | Validation-map coverage, live harness audit, audit-fixture consistency, and harness-script sibling-test policy. |
| Validate | `pr:athena:validate` | Provider half (docs check, workflow check, Convex audit and lint, frontend lint, architecture, `tsc --noEmit`, coverage), then writes provider evidence, then the review half (harness review, inferential review, audit, graphify check). |
| Record proof | `pr:athena:record-proof` | Records the git-private proof for the validated tree. |
| Scorecard | `pr:athena:scorecard` | Runs against the current delivery-run ledger. |

Inside the ladder, `harness:review` is called with
`--repo-validation-provided-by pr:athena` plus a `--provider-evidence` path,
because the repo-owned validation commands already ran directly.

The two provider flags are similarly named but differ in **scope**, and passing
the wrong one silently changes how much work review skips:

| Flag | Scope |
| --- | --- |
| `--repo-validation-provided-by pr:athena` | Narrow. Suppresses only the repo-owned validation set. Package validation still runs, because `pr:athena` leaves package selection to review. |
| `--validation-provided-by athena-pr-tests` | Broad. Suppresses the repo-owned set *and* prunes package commands the PR workflow runs as separate jobs, leaving validation-map checks and behavior scenarios. |

Neither is a legacy alias of the other. Standalone `harness:review` and
`pre-push:review` pass neither flag and stay fail-closed.

### Inferential Review Modes

The deterministic lane always runs and is the blocking source of truth. The
semantic shadow lane is opt-in:

```sh
HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review
HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow bun run harness:inferential-review --persist-history
```

The shadow lane calls the Anthropic API. When `ANTHROPIC_API_KEY` is not
configured it records a `skipped` status rather than failing the deterministic
lane. `HARNESS_INFERENTIAL_ANTHROPIC_MODEL` overrides the default model.

## Behavior Scenario Reference

`bun run harness:behavior --list` prints these from the registry, and
`harness:check` keeps this section in sync with it. Bundled scenarios include:

| Scenario | Covers |
| --- | --- |
| `sample-runtime-smoke` | Minimal local app boot, browser click, signal propagation, teardown. |
| `athena-admin-shell-boot` | Admin-shell fixture with deterministic auth bootstrap. |
| `athena-convex-storefront-composition` | Authenticated shell driving a Convex-backed storefront route composition. |
| `athena-convex-storefront-failure-visibility` | Convex composition failures stay visible in browser state. |
| `athena-qa-live-smoke` | Live QA surface; fails on blank app, page errors, failed same-origin requests, or 5xx resources. |
| `valkey-proxy-local-request-response` | Local Valkey proxy round trip with an in-memory client. |
| `storefront-backend-first-load` | First-load backend requests; fails on direct Convex browser traffic, CORS/preflight failures, or non-2xx API responses. |
| `storefront-checkout-bootstrap` | Checkout bootstrap UI and runtime signals. |
| `storefront-checkout-validation-blocker` | Invalid checkout-session routing surfaces the validation blocker. |
| `storefront-checkout-verification-recovery` | Paystack-origin redirect and verification recovery to checkout complete. |

Add `--record-video` to persist browser evidence under
`artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

Scenario thresholds live in `scripts/harness-behavior-scenarios.ts`:

- `runtimeSignals[].minMatches` / `runtimeSignals[].maxMatches` — expected match
  counts for a named runtime signal.
- `thresholds.latency.maxTotalDurationMs` — ceiling for the whole run.
- `thresholds.latency.maxPhaseDurationMs` — a per-phase map, not a single value.
  Phases are `boot`, `readiness`, `browser`, `runtime`, `assertion`, and
  `cleanup`. Scenarios share preset budgets, so storefront scenarios allow a much
  longer boot than the sample runtime does.

## Artifacts And CI Reference

`harness:check` reads the scenario list above by scanning from its marker to the
next `##` heading, so this heading also bounds that scan. Keep it at `##` level:
scenario-shaped names in backticks below it would otherwise be read as part of
the scenario list.

### Artifacts

Tracked, freshness-gated graphify artifacts:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/*.md`

`graphify-out/graph.html` is committed but sits outside the freshness gate. See
[Graphify](./graphify.md) for the artifact and Python-runtime details.

Local and CI evidence outputs, all git-ignored:

| Path | Written by |
| --- | --- |
| `artifacts/harness-scorecard/latest.json` | `harness:scorecard` |
| `artifacts/harness-inferential-review/latest.json` | `harness:inferential-review` |
| `artifacts/harness-inferential-review/history/<run-stamp>.json` | `harness:inferential-review --persist-history` |
| `artifacts/harness-behavior/trends/latest.json` | `harness:runtime-trends` |
| `artifacts/harness-behavior/trends/history/<run-stamp>.json` | `harness:runtime-trends --persist-history` |
| `artifacts/harness-behavior/videos/<scenario>/<run-stamp>/` | `harness:behavior --record-video` |
| `artifacts/harness-delivery-runs/` | `pr:athena` delivery-run ledger and provider evidence |
| `artifacts/harness-contract-preflight/latest.json` | `pr:athena:preflight` |
| `graphify-out/cache/` | `graphify:rebuild` |

These are ignored on purpose. `graphify-out/cache/` is a large local
acceleration cache, and the `artifacts/harness-*` paths are machine-generated
evidence, not reviewable source.

### GitHub Actions Wiring

`.github/workflows/athena-pr-tests.yml` runs on pull requests, on a weekly
schedule (Mondays 14:00 UTC), and on manual dispatch.

- The `harness-validation` job runs self-review, review with
  `--validation-provided-by athena-pr-tests`, docs check, architecture check,
  audit, inferential review in `shadow` mode, scorecard, and graphify freshness.
- The `harness-janitor` job runs only on schedule or manual dispatch. It runs the
  janitor in report mode, persists inferential history, persists runtime trend
  history, and regenerates the telemetry scorecard.
- Manual dispatch accepts literal `[harness:behavior:report]` lines as an input,
  which the janitor job pipes into `harness:runtime-trends --persist-history`.
- Both jobs upload their artifacts with `if: always()` so failures stay
  inspectable.

### Git Hooks

Run `bun install` (or `bun run prepare`) after cloning to point Git at the
tracked hooks in `.husky/`. Worktrees inherit the repo config, so using the
tracked `.husky` directory avoids the missing generated shim problem that a
`.husky/_` layout produces.

- `pre-commit:generated-artifacts` runs `harness:generate` and
  `graphify:rebuild`, then stages the tracked generated outputs so the commit
  includes refreshed artifacts.
- `pre-push:review` starts with `graphify:check`, then
  `delivery:documentation-check`, then the rest of the local suite. If tracked
  graphify artifacts are stale it rebuilds once, rechecks, and stops so the
  repaired artifacts can be reviewed and committed. If `harness:self-review` or
  `harness:review` is blocked by stale generated docs, it runs `harness:generate`
  once, retries, and then blocks for the same reason.

For repo-harness edits such as `scripts/harness-app-registry.ts`, keep
`bun run harness:review --base origin/main` and
`bun run harness:inferential-review` in the local ladder so a missing sibling
test like `scripts/harness-app-registry.test.ts` fails before push.
