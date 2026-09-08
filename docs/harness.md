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

For the component and control-flow view, see the
[harness architecture overview](./architecture/harness.md). This document
remains the source of truth for commands, gate semantics, artifacts, CI wiring,
and failure handling.

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
hook, which runs `bun run pre-push:review` behind a bounded-output wrapper. The
wrapper writes the full child stream to a temporary log, emits periodic
heartbeats, removes the log after success, and retains it with a 200-line tail
after failure. Validation still runs fail-closed with its original exit code.

GitHub Actions runs the repo harness in `.github/workflows/athena-pr-tests.yml`.
CI repeats the important sensors so local success and remote review stay aligned.

## What The Sensors Do

### Freshness Sensors

Freshness sensors catch stale generated artifacts.

- `harness:check` verifies generated harness docs and package validation maps.
- `graphify:check` verifies tracked graphify outputs.
- `pre-commit:generated-artifacts` runs `harness:generate` and
  `graphify:rebuild`, then stages tracked source changes and generated outputs.
- `pr:athena:prepare` invokes installed product preparation. Athena's configured
  commands check Bun and dependency parity, repair generated artifacts, and run
  mechanical validation before the product captures a candidate and publishes a
  preparation receipt. Stage intended new files explicitly.
- `pr:athena` runs the installed gate, exports and stages product run telemetry,
  refreshes record-neutral preparation, writes and stages the portable delivery
  record, refreshes preparation again, and verifies the resulting candidate.
  Preparation and independent review are prerequisites to this sequence.
- `pr:athena:validate` invokes the installed product's `gate` command.
- `pr:athena:record-proof` invokes the installed product's `record` command,
  which writes the tracked portable delivery record.
- `pre-push:review` invokes installed product verification of the current
  candidate and evidence. It neither repairs generated files nor reruns the
  local validation suite.

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

### Blocker And Remediation Contract

Fail-closed harness commands share the typed contract in
`scripts/harness-blockers.ts`. A `HarnessBlocker` has a stable machine code, a
typed source, a concise summary, optional sanitized details, and a non-empty
remediation tuple. Sources identify the policy or execution boundary that owns
the failure: a gate, obligation, provider, preparation receipt, candidate
capture or drift check, or package-script-reachable command.

Remediations are typed as `command`, `manual_action`, `code_change`, or
`retry`. Pick the kind by what the operator has to do, not by how the text
reads:

| Kind | Use it when | Carries a command |
| --- | --- | --- |
| `command` | A deterministic repair exists and should be run now. | Required |
| `retry` | Nothing is wrong with the repo; rerun once an external or transient condition clears. | Optional |
| `code_change` | A source edit is required before the check can pass. | No |
| `manual_action` | A human must decide or act outside the repo (review, waiver, inspecting a log). | No |

The internal-error boundary is separate from all four: it is reserved for
genuinely unexpected exceptions, and its guidance is diagnostic rather than a
repair to run. Do not reach for it to report an expected policy failure.

Remediation of every kind is guidance, not authorization. A blocker describes
what the owning boundary believes would unblock the command; it does not grant
permission to perform that repair automatically. Whether a `command`
remediation may run without a human deciding is governed by the repo's
existing bounded self-repair policy - one repair, one rerun, and only for
deterministic drift - not by the blocker having named it. The renderer never
executes anything it prints.

Commands are stored as argument arrays, not interpolated shell strings. This
keeps the machine representation safe to inspect and reuse; terminal output
quotes those arguments only when it renders them for a human. Stable
remediation ids let a command report all blockers together while printing a
repeated repair only once.

Both output forms must derive from the same blocker objects:

- `formatHarnessBlockers` produces bounded, deterministic terminal guidance.
- `serializeHarnessBlockers` produces the versioned structured-event payload.
- `createHarnessInternalErrorBlocker` converts unexpected exceptions into the
  same contract while removing control characters and redacting common secret
  shapes.

Delivery run events and exports use the installed product's schema and reader.
Athena does not maintain a second gate-decision event directory or translate old
wrapper ledgers into current evidence. Regenerate records through the installed
commands when their binding is stale or their format is unreadable; journal
observations do not themselves authorize admission.

Do not throw or print a new operator-facing blocker as free-form prose. Create
the blocker at the owning source, preserve it through orchestration, and choose
the terminal or structured renderer only at the output boundary.

`scripts/harness-blocker-inventory.ts` is the enforcement sensor for this
contract. It inventories root harness CLIs reachable through package scripts
and blocks commands that lack structured remediation coverage or introduce a
new unstructured blocker path. New commands must register and use the shared
contract immediately.

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
repo validation command set: `workflow:check`, `harness:test`,
`delivery:documentation-check`, `test:coverage`, and `harness:inferential-review`.

Standalone and provider-invoked `harness:review` use the same selection and
required sensor set. Athena's validation provider invokes
`harness:review --base origin/main`; the command accepts only `--base`, with no
parent-provider skip mode. It deduplicates overlapping selected commands within
that invocation.

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

Before `pr:athena`, run `pr:athena:prepare`, then establish current independent
review evidence under AGENTS.md steps 6 and 9. The coordinator then sequences the
installed gate, telemetry export, record-neutral preparation refreshes, portable
record, and final verification described in [Delivery Ladder Phases](#delivery-ladder-phases).

`pr:athena:prepare` delegates to the installed product. Athena config declares
Bun and dependency checks, generated-artifact repair, and mechanical validation;
the product owns candidate capture, preparation receipt publication and failure
handling. Generated-artifact repair stages tracked changes. Stage intended new
files explicitly before preparation.

The mechanical stage (`pr:athena:mechanical`, also runnable on its own) runs the
deterministic checks for the changed files: the per-package lint scripts the
validation map selects, plus the project typecheck of every package that has a
changed file *and* declares a typecheck in its validation scenarios (so
`valkey-proxy-server`, which declares none, gets none). Typecheck is
package-scoped rather than scenario-scoped because `tsc -p` is project-wide — a
file whose validation scenario happens not to list the typecheck command can
still break it. It exists to fix an ordering problem: those checks used to run
only inside the heavy provider, which is gated behind `review.green`, so a lint
rule could fail only *after* an expensive multi-agent review had been recorded,
and the one-line fix then invalidated that review. Because preparation publishes
no receipt when a mechanical check fails, and both `harness:review-context` and
gate admission require a current receipt, **a tree that fails a mechanical rule
selected for its changed files can never reach review**. Selection is
per-package, so a branch that touches no package — this file's own harness
scripts, for instance — selects nothing and relies on the heavy provider as
before. Tests and build stay in the heavy
provider — they are neither cheap nor purely mechanical — but typecheck belongs
here: it is deterministic, it is the class the ticket names alongside lint, and
~45s at prepare is far cheaper than the review round a late type error would
invalidate.

`pr:athena:preflight` runs inside `harness:review` before its expensive checks.
It aggregates validation-map coverage, live harness audit, audit-fixture
consistency, and harness-script sibling-test policy. Its failure report names the registry source,
generated-doc repair, fixture and sibling-test files, and the focused
verification command, so a preflight failure is actionable without reading the
sensor source.

`pr:athena:validate` invokes the installed product gate. `harness.config.ts`
declares the repository obligations, and the product resolves each as a
live fact, exact-candidate evidence, human waiver, repository-authorized CI
delegation, non-applicability, or a block. These are distinct outcomes: a waiver
or delegation is never reported as provider-green evidence.

The initial `review.green` obligation activates at 50 relevant changed lines, a
relevant binary change, or an explicitly review-sensitive validation scenario.
Recognized agents must present final-green evidence from `ce-code-review` or
`execute`; a PTY does not make an agent human. Interactive humans may deliberately
waive review for the exact worktree/candidate/base, while CI delegation requires
the allowlisted `athena-pr-tests` workflow/job/event policy. The
`documentation.current` obligation remains an always-on live fact. A human
exception for its delivery-documentation policies — the solution note and
landed-change report — requires the GitHub-backed approval described below,
bound to a real pull request's candidate and base. The installed gate consumes
the resulting documentation sensor result; Athena config does not permit a
separate local product waiver for this live obligation.

To request that candidate-bound documentation approval, commit and push the
exact candidate and rerun preparation against that clean commit. A human or agent may dispatch the unprivileged request
workflow; dispatch is not approval. That default-branch relay uses its
job-scoped `GITHUB_TOKEN` to start the protected issuer as
`github-actions[bot]`. Before it can dispatch the issuer, the relay asks Athena
for a single-use, 15-minute WebAuthn challenge and waits for the enrolled iPhone
passkey to approve the exact candidate with user verification. No App private
key, installation token, broker secret, or other Actions-write credential
enters the requesting process. The relay uploads the typed request and passkey
approval identifier as an immutable run artifact; the issuer consumes that
approval exactly once and verifies it against the relay artifact and exact
successful default-branch run. The protected GitHub Environment remains a
second defense-in-depth review. If preparation repairs or stages anything,
commit and push those changes and prepare again before requesting the waiver:

Successful passkey verification closes the authentication window and opens a
separate 10-minute consumption window for the protected issuer, so a valid
Face ID approval near minute fifteen is not already stale while GitHub waits
for the defense-in-depth environment review.

```sh
bun run pr:athena:prepare
bun run harness:waive-documentation --pr <number> --reason "<why this exception is acceptable>"
```

The request dispatches the default-branch `Athena Documentation Waiver`
workflow. Its `athena-documentation-waiver` environment must be configured with
`kwam1na` as a required reviewer, self-review prevention, and administrator
bypass disabled. The request relay alone receives job-scoped Actions write
permission and the broker secret. Configure `ATHENA_WAIVER_API_URL` as a
repository variable and the matching `ATHENA_WAIVER_BROKER_SECRET` as both a
GitHub Actions secret and Convex production environment secret. Convex also
requires `ATHENA_WAIVER_REVIEWER_EMAIL`, `ATHENA_WAIVER_RP_ID=athena-os.app`,
`ATHENA_WAIVER_ORIGIN=https://athena-os.app`. Initial enrollment temporarily
requires `ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH`, the lowercase SHA-256 digest of a
one-time bootstrap secret chosen and configured by the reviewer outside any
agent runtime. The reviewer opens `/<org>/settings/waiver-passkey` on the
iPhone while signed into the authenticated Athena shell, enters that secret,
and enrolls once. The shell's authenticated Convex mutation issues a
one-minute, single-use authorization ticket to the Node/WebAuthn ceremony; the
action does not infer identity from the visible shell or accept a caller-supplied
reviewer email. Enrollment is locked after the first credential. Remove the
enrollment-token hash from production after the
trusted enrollment succeeds. WebAuthn verifies a platform authenticator and
user verification, but does not attest the device make; the iPhone is an
operational enrollment requirement.

After passkey and environment approval, the issuer downloads the relay artifact,
verifies its workflow path, run, branch, conclusion, requester, exact inputs,
pull-request freshness, and environment approval, then consumes the passkey
approval and immediately finalizes the attestation. Consumption is idempotent
only for the same exact candidate so a transient artifact/check publication
failure can safely retry without authorizing different work. It requires the
dispatcher to be the exact `github-actions[bot]` identity and the approver to be
an authorized GitHub user distinct from that bot, rechecks the live pull-request
head and base, and publishes both a check run and an immutable workflow artifact
that record both GitHub identities and the passkey credential identifier, and
bind the waived finding codes to the PR head, base tip, merge base, and
deliverable-tree identity. CI downloads the artifact from that verified
default-branch workflow run before the documentation sensor accepts the human
approval; it never trusts branch-authored JSON or check output by itself. A new
commit, a moved base, an uncovered documentation finding, an unauthorized actor,
or missing workflow, relay, or WebAuthn provenance makes the waiver stale and CI fails closed. The
documentation exception requires a real pull request; the same verified
GitHub-backed attestation is consumed by local and CI admission.

The `telemetry.recorded` obligation asks whether this delivery left a durable
product run export under `telemetry/delivery-runs/`. Its successful gate event
must match the current strict validation projection. The consumer compares the
product-authored digest; it does not require the old staged Git tree to exist in
a receiving clone.

`pr:athena` exports and stages telemetry after its gate succeeds, then stages the
product delivery record and verifies the result. `delivery:telemetry-record`
remains available to export the current run after a successful gate. If used
separately, stage the export and request installed preparation with
`--refresh-record-neutral` before recording and verifying. Commit the resulting
artifacts with the delivery. The product run can remain open through the real
finish line; exporting it does not assert `run.ended` or whole-run cost.

The demand scales with the delivery: below 150 changed source lines — the same
threshold `compound:check` uses for solution notes — no record is required at
all, though a record that is present and malformed is still reported at any
size. Locally the demand waits until a *passing* gate run has completed against
the current deliverable, because the record it asks for can only come from such a
run; CI, the merge authority, has no such leniency.
An export for an older strict validation projection is stale. Only a
successfully completed gate for the current projection satisfies this check;
report and solution-note freshness have their own bindings. Athena config does
not permit a product waiver for `telemetry.recorded`; repair and export the
current telemetry instead. CI also enforces it through
`bun run delivery:telemetry-check`.

Approved review workflows run `pr:athena:prepare`, then establish current
independent review evidence under AGENTS.md steps 6 and 9. When acquisition is
required, capture `harness:review-context`, complete the independent review and
submit the manifest path the product returns through `harness:review-evidence -- --manifest <returned-path>`.
For an active obligation eligible for reuse, retain the product's positive
review-evidence resolution. An inactive `not_applicable` obligation requires
neither acquisition nor evidence reuse. A review fix
requires preparation again; it requires another complete review when the product
reports missing or stale review evidence, or new actionable feedback requires it.

`delivery:resume` requires a current delivery run with a saved accepted contract
and stage. Preserve existing context before checking freshness; saving fresh
context first would hide the drift the command is meant to observe. If it
reports `resume_context_missing` because no context was saved, it emits no JSON.
Recover the accepted contract from the work item, ensure the intended delivery
run is current, and save it before retrying:

```sh
bun scripts/delivery-product.ts save-context --json '{"contract":{"objective":"<accepted objective>","acceptanceCriteria":["<accepted criterion>"],"finishLine":"<authorized finish line>"},"stage":"<current stage>"}'
```

Replace the placeholders with the actual accepted contract, including every
criterion; do not invent a new contract to obtain admission. The product captures
candidate, policy and release bindings itself. Empty output or a nonzero exit
is never positive proof by itself; retain other admission or recovery blockers
for their own stages.

Use `bun run delivery:resume` and inspect `admission.decision.resolutions` for
`obligationId: "review.green"` with `kind: "satisfied_evidence"`. Retain the
resolution's record and candidate binding and require the full selected lens set,
unanimous approval, discharged tracking and no new actionable review feedback.
Only `satisfied_evidence` is positive review-reuse proof. A current product `not_applicable` resolution means `review.green` is inactive for this candidate and requires no acquisition; it is not evidence reuse. For an active review obligation, every other or missing resolution, including `waived`, requires complete acquisition. Overall
`reuseAllowed` and exit status describe the entire resumed delivery: other
admission or recovery blockers remain blocking for their own stages and do not
by themselves require another review.

Review evidence binds to the candidate's **deliverable identity**, not its raw
tree SHA. The installed product computes `deliverable-tree/v1` using the
review-neutral narration set declared in `harness.config.ts`; candidate binding
also carries the base and workspace context. The separate `recordNeutral` rule
is limited to JSON files under `telemetry/delivery-runs/`, so sibling telemetry
directories do not inherit that exemption. The consequence is narrow and
deliberate:

- Committing a landed-change report or a solution note after the final pass does
  **not** invalidate the recorded review evidence. The configured telemetry
  narration prefix is also review-neutral. Preparation must be rerun, because
  the receipt still binds to the raw tree, but the review does not.
- Any other change does invalidate it, including a comment-only edit, a mode
  change, a rename with identical contents, and any edit under `_generated/`,
  `routeTree.gen.ts`, `graphify-out/`, or `artifacts/`. The neutral set is
  deliberately narrower than `isDeliverableFingerprintPath` in
  `scripts/delivery-diff-fingerprint.ts`, which answers a different question
  (report freshness) and may exclude generated artifacts that nothing here
  re-derives.
- Both the reviewed raw tree and the deliverable identity are written into the
  product evidence binding, so a past authorization stays interpretable. The raw tree
  is verified at recording time — `harness:review-evidence` still requires an
  exact `treeSha` match, because recording happens against the tree that was
  just prepared and reviewed. Only the later gate comparison is identity-only.
- A record written before the identity existed stays readable and self-consistent
  but cannot match a current candidate, so it fails closed as stale evidence.

The installed product gate evaluates Athena's configured obligations, including
validation and documentation evidence. Athena's `harness:review` owns the heavy
sensor command list and runs `pr:athena:scorecard` after inferential review and
Graphify freshness, before the coordinator exports telemetry and writes the
delivery record.

`pr:athena:record-proof` is the compatibility entry point for installed product
`record`; it writes portable evidence rather than a git-private pre-push cache.
`pre-push:review` calls installed `verify` against the current candidate. A stale
or missing binding blocks the push; it does not trigger an Athena proof-reuse
path or an automatic validation/repair loop. Resolve the reported blockers and
run the preparation, review or gate steps they require before pushing again.

For harness-only changes, useful focused commands are:

```sh
bun run harness:test
bun run harness:check
bun run harness:review --base origin/main
bun run harness:inferential-review
bun run graphify:check
```

Local validation and the Athena PR workflow both run
`harness:review --base origin/main`. The command owns the repository sensors,
mapped package validation, and selected runtime behavior scenarios. The installed
product invokes it through Athena's declared validation provider during local
admission; CI invokes the same command directly after its evidence checks.

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
2. Read the blocker source and stable code to identify the owning boundary.
3. Follow the typed remediation in order. Run a `command` or `retry` argument
   list as shown; perform a `manual_action` or `code_change` deliberately rather
   than treating it as executable text.
4. Review the diff.
5. Commit the source change and its refreshed evidence together.

When several blockers are reported, resolve their deduplicated remediations and
rerun the authoritative command. If the output reports
`harness_internal_error`, inspect the retained log before retrying; its details
are diagnostic context, not a substitute for the named reproduction command.

`harness_internal_error` is reserved for unexpected exceptions in Athena's
command boundary. Athena usage errors name the supported flags. Installed
product commands retain their own typed failures and interruption outcomes;
inspect the retained command output rather than expecting retired wrapper
`delivery_run_interrupted` events.

Avoid weakening the sensor to get past a failure. If the failure is noisy, fix
the sensor's precision with a test so the repo learns from the false positive.

Repeated command execution within one `harness:review` invocation is avoided by
deduplicating its selected and required commands. Receipt reuse is a separate
installed-product decision: `prepare --refresh-record-neutral` reuses success
only when strict validation, policy, wiring and base still match. Ordinary
preparation runs its checks. Pre-push verification reports current admission;
it does not report Athena-specific proof-cache statuses.

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
| `bun run delivery:resume` | Read saved context and current admission resolutions, including `review.green`, without replaying actions. |
| `bun run delivery:documentation-check` | Combined solution-note and landed-change-report policy check. |
| `bun run delivery:telemetry-record` | Export current product run telemetry after a successful gate. |
| `bun run delivery:telemetry-check` | Enforce a current delivery-run telemetry record for substantial deliveries. |
| `bun run reports:presentation:check` | Presentation contract for every `docs/reports/*.html`. |
| `bun run docs:links:check` | Cross-references in `docs/solutions/**/*.md` resolve to servable docs. |
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

Prepare the candidate with `pr:athena:prepare`, then establish current independent
review evidence under AGENTS.md steps 6 and 9: obtain and submit a complete review
when required, or retain the product's positive review-evidence resolution. Run
`pr:athena` only with its prerequisites satisfied. Preparation invokes the
installed product's configured dependency, generated-artifact and mechanical checks.

`pr:athena` delegates to `pr:athena:delivery-run`, which sequences installed
product commands against the saved accepted delivery contract:

| Phase | Owner | Notes |
| --- | --- | --- |
| Admission | Installed product `gate` | Evaluates current obligations; Athena's declared validation provider runs `harness:review --base origin/main`. |
| Durable telemetry | Athena export location | Exports and stages product run telemetry after the gate, then requests `prepare --refresh-record-neutral`. |
| Delivery record | Installed product `record` | Writes the portable delivery record; the coordinator stages it and requests another record-neutral preparation refresh. |
| Final verification | Installed product `verify` | Verifies the resulting candidate and its delivery evidence. |

`harness:review` owns preflight, the repository validation set, mapped package
checks, and selected behavior scenarios, followed by inferential review,
Graphify freshness, and `pr:athena:scorecard`. Its CLI accepts `--base`; there
is no provider flag that skips these checks for the local ladder or CI.

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

Tracked delivery artifacts under `telemetry/delivery-runs/` include the product
run export written by `delivery:telemetry-record` and the portable record written
by installed `record`. Athena's coordinator stages both.

The journal is owned by the installed product under the repository's Git common
directory; Athena consumes its export without maintaining a second ledger. The configured record-neutral JSON
paths permit strict artifact-only preparation refresh without granting the
same exception to arbitrary source, reports or other telemetry files.

Local and CI evidence outputs, all git-ignored:

| Path | Written by |
| --- | --- |
| `artifacts/harness-scorecard/latest.json` | `harness:scorecard` |
| `artifacts/harness-inferential-review/latest.json` | `harness:inferential-review` |
| `artifacts/harness-inferential-review/history/<run-stamp>.json` | `harness:inferential-review --persist-history` |
| `artifacts/harness-behavior/trends/latest.json` | `harness:runtime-trends` |
| `artifacts/harness-behavior/trends/history/<run-stamp>.json` | `harness:runtime-trends --persist-history` |
| `artifacts/harness-behavior/videos/<scenario>/<run-stamp>/` | `harness:behavior --record-video` |
| `artifacts/harness-contract-preflight/latest.json` | `pr:athena:preflight` |
| `graphify-out/cache/` | `graphify:rebuild` |

These are ignored on purpose. `graphify-out/cache/` is a large local
acceleration cache, and the `artifacts/harness-*` paths are machine-generated
evidence, not reviewable source.

### GitHub Actions Wiring

`.github/workflows/athena-pr-tests.yml` runs on pull requests, on a weekly
schedule (Mondays 14:00 UTC), and on manual dispatch.

- On pull requests, `harness-validation` first verifies the installed product
  and portable delivery evidence with `policy:check` and `delivery:verify`,
  requiring Athena's two mandated review lenses. It checks delivery documentation
  with `delivery:documentation-admission` and the delivery-run telemetry record
  with `delivery:telemetry-check`, then installs the Graphify runtime and
  Playwright browser. One `bun run harness:review --base origin/main` step owns
  the repository sensor set and selected validation. That step sets
  `HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow` and `ATHENA_COVERAGE_MAX_WORKERS`.
  Product/evidence verification is pull-request-only; the other steps also run
  on the workflow's scheduled and manual triggers.
- The `harness-janitor-report` job runs only on schedule or manual dispatch. It
  runs the janitor in report mode, persists inferential history, persists runtime
  trend history when behavior logs are available, and regenerates the telemetry
  scorecard.
- Manual dispatch accepts literal `[harness:behavior:report]` lines as an input,
  which the janitor job pipes into `harness:runtime-trends --persist-history`.
- The validation and janitor jobs upload their artifacts with `if: always()` so
  failures stay inspectable. Separate jobs run harness implementation tests,
  webapp builds, and production POS end-to-end tests.

### Git Hooks

Run `bun install` (or `bun run prepare`) after cloning to point Git at the
tracked hooks in `.husky/`. Worktrees inherit the repo config, so using the
tracked `.husky` directory avoids the missing generated shim problem that a
`.husky/_` layout produces.

- `pre-commit:generated-artifacts` runs `harness:generate` and
  `graphify:rebuild`, then stages the tracked generated outputs so the commit
  includes refreshed artifacts.
- `pre-push:review` delegates to installed product `verify`. The hook retains
  bounded logging and interruption handling; candidate/evidence failures block
  the push. Generated-artifact repair belongs to preparation or explicit repair
  commands, whose changes must be reviewed and committed.

For repo-harness edits such as `scripts/harness-app-registry.ts`, keep
`bun run harness:review --base origin/main` and
`bun run harness:inferential-review` in the local ladder so a missing sibling
test like `scripts/harness-app-registry.test.ts` fails before push.
