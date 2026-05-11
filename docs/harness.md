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
- `pr:athena` records a git-private proof after the final graphify check only
  when the branch head, `origin/main`, validation wiring, Bun version, and
  working tree are clean and current. A later `pre-push:review` may reuse that
  proof instead of rerunning the whole local suite.

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
agents deliver work. A changed solution note must include the expected
frontmatter and the `Problem`, `Solution`, and `Prevention` sections; placeholder
notes do not satisfy the gate.

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
repo validation command set: `harness:test`, `compound:check`, `test:coverage`,
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

That command repairs generated artifacts first, then runs the main repo ladder:
Convex audits, architecture checks, coverage, harness tests, generated-doc
checks, review sensors, audit, scorecard, and graphify freshness.

After the final `graphify:check`, `pr:athena` records a worktree-local proof for
the current `HEAD` and `origin/main`. `pre-push:review` reuses that proof only
when the pushed head, base SHA, clean working tree, Bun version, `pr:athena`
script, and validation wiring fingerprint still match. Any dirty file,
generated-artifact repair, rebase, advanced `origin/main`, changed hook, changed
harness script, or missing proof makes pre-push run the full validation suite
normally and prints the reason.

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
