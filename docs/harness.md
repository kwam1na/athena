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

In the default legacy path, repeated command execution within one `harness:review` invocation is avoided by
deduplicating its selected and required commands. Receipt reuse is a separate
installed-product decision: `prepare --refresh-record-neutral` reuses success
only when strict validation, policy, wiring and base still match. Ordinary
preparation runs its checks. Pre-push verification reports current admission;
it does not report Athena-specific proof-cache statuses.

## Affected Validation Qualification

Legacy validation remains the default. The affected path is an explicit
qualification mode; V26-2071 owns activation after its evidence is complete.
Neither a comparison plan nor a green CI validation record replaces the delivery
contract, independent review, `pr:athena`, or pre-push verification.

Athena owns check membership, consumer analysis, command characterization,
execution-profile declarations, and protected health admission. The installed
product owns private execution, attempt identity, evidence reuse, portable
records, and verification. Read the selected release with `bun run delivery:status`
and check its compiled policy with `bun run policy:check`. Qualification belongs
to that exact release and policy; do not transfer an older archive's results to a
successor or bypass a missing scoped-execution capability. The implementation
boundaries are [capture](../scripts/harness-validation-capture.ts),
[policy projection](../scripts/harness-validation-policy.ts), and the
[public native lifecycle adapter](../scripts/harness-validation-native.ts).

### Selection, Execution, And Reuse

`bun run harness:plan -- --help` documents the read-only planner. For example:

```sh
bun run harness:plan -- --input scripts/fixtures/affected-validation/planner/report-request.json --json
```

This fixture demonstrates selection, not evidence for the working tree. Native
capture uses `--capture-config <config.json> --mode <delivery|comparison|full-health>`
with the complete trusted configuration. The planner's `delivery` mode does not
activate delivery: `harness.config.ts` currently accepts only `comparison` or
`full-health` through `ATHENA_VALIDATION_MODE`, and otherwise loads legacy policy.

The local opt-in reads the authenticated default branch's generated
[health inventory](../.agents/validation-health-inventory.json) and current health
before selecting checks. Relevant findings or unavailable history require the
complete full-health plan; missing trusted inventory or workflow identity blocks
selection. The [local live check](../scripts/harness-validation-local-health-check.ts)
reads authority and source selection again during admission. It requires the
original health revision and validation context, while the product independently
requires every selected check to pass. A successful candidate repair leaves the
global finding open until protected revalidation closes it.

Read each check's `reasons`, exact membership, inputs, and prerequisites. Surface
matches explain selection; supersession explains why one declared check covers
another. Base and candidate consumer graphs preserve deleted or renamed
consumers. Unknown imports, uncharacterized runner configuration, removed tests,
and unresolved consumers widen to the declared package or repository fallback.
Unknown impact never means no work. Full-health selects the complete inventory,
including aggregate floors that a focused unit slice cannot establish.

The [command projection](../scripts/harness-validation-command.ts) preserves
exact test membership. Package typechecks and asset builds are separate
obligations; an asset build requires its package typecheck. The public package
`build` command still includes both Vite and TypeScript. Exact characterized root
TypeScript commands share the package typecheck obligation; additional flags or
shell syntax are not silently normalized. Test/build script changes and lifecycle
hooks must be characterized before the affected executor accepts them.

The [runtime profiles](../scripts/harness-validation-runtime.ts) are explicit:

| Profile | Git context | Declared use |
| --- | --- | --- |
| `athena-typecheck-none` | `none` | Only the two app `package-types` checks; retains their complete declared inputs, including storefront's Athena dependencies, and declares no mutable outputs. |
| `athena-core-full` | `full` | Checks that produce no declared artifacts. The selection guard has its own dependency-free full-Git profile. |
| `athena-webapp-unit-none`, `athena-storefront-unit-none` | `none` | Exact qualified package unit commands and memberships; each may write only its package's pinned Vitest results cache under `.cache/vitest/`. |
| `athena-webapp-build-none`, `athena-storefront-build-none` | `none` | Exact qualified asset-build commands; each may write only its package's `dist/`. |
| `athena-webapp-unit-full`, `athena-storefront-unit-full`, `athena-webapp-build-full`, `athena-storefront-build-full` | `full` | Fallback for unqualified commands or memberships, with the same package-specific cache or build output permissions. |
| `athena-coverage-full`, `athena-storybook-full`, `athena-inferential-full` | `full` | Separate coverage, Storybook and inferential artifact directories. |
| `athena-behavior-full` | `full` | Runtime scenarios with browser dependencies and `artifacts/harness-behavior/` output. |
| `athena-browser-full`, `athena-storefront-browser-full` | `full` | Browser checks with browser dependencies; bound Playwright flags relocate reports/results under `artifacts/validation-playwright/`. Operator browser checks also permit their app build output. |

Mutable outputs are write permissions, not source exclusions. Broad `artifacts/`
and the tracked storefront Playwright report are not writable profile roots.
The runtime regression checks every output declaration against the actual tracked
inventory. The [qualification catalog](../scripts/fixtures/affected-validation/frontend-qualified-profiles.json)
retains the six native record digests and exact exercised commands and memberships.
The source, existing-report and new-report cases for both applications passed
native preparation, gate, record and verification: 33 scoped/full pairs matched,
and report follow-ups retained 14 prior attempt selections. Eligibility requires
the complete command and membership tuple; adding or removing a test falls back
to private Git. Specific Convex contract tests in the qualified frontend groups
are included, while arbitrary backend groups and whole-package suites are not.
Qualification's diagnostic output directory is not a production write permission.
This evidence does not establish hosted health, performance or default activation.

Both package Vitest configurations relocate their cache outside `node_modules`.
The pinned unnamed Vitest project writes
`.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`;
unit profiles allow only that exact package-local file, and coverage permits both
package result files alongside its reports. Installed dependencies and adjacent
cache files remain protected. A Vitest upgrade or project-name change requires
checking the actual cache path and qualifying the corresponding profile change.

No-Git qualification is not permission to remove source inputs or apply that
profile to another command. Full profiles retain the declared Git context;
base movement may invalidate evidence even when source bytes appear unchanged.
Dependency setup, mutable outputs, environment flags, and credential identities
are part of the declared profile. Unavailable credentials do not count as tested
coverage.

A plan digest describes selected work. Only successful native verification binds
passing attempts to the record. Inspect the adapter's phase results, selected
attempts and before/after observations to distinguish execution from reuse;
retain the product's invalidation/refusal reason. Failed, tampered, incompatible,
or differently bound evidence cannot be promoted by editing a summary. Policy,
release, profile, input, environment, and base changes must pass the product's
current freshness decision. Do not infer reuse from a previous green log.

Reports can be neutral to review while remaining inputs to report presentation,
link, fingerprint, or documentation-publishing checks. A report refresh should
select those obligations without unnecessarily rerunning unrelated application
tests, but only actual native evidence can establish which checks were reused.
Publishing still includes its declared build/typecheck prerequisites.

### Hosted Trust And Health

The [PR workflow](../.github/workflows/athena-pr-tests.yml) defaults to `legacy`;
its manual `validation_mode: affected-qualification` input exercises the affected
path. The hosted CLI advertises its exact interface:

```sh
bun run harness:validation-ci -- --help
```

`guard --candidate-root <absolute-path>` runs from the pinned trusted base. It
authenticates workflow, repository, run, head and base, and requires clean,
separate checkouts. Historical absence of the guard or a committed authority
change selects legacy validation. A malformed, modified, escaping, or mismatched
present guard fails closed. Candidate configuration and uploaded JSON cannot
appoint themselves as trusted policy.

`qualify` drives native `prepare`, `gate`, `record`, then `verify`. A clean final
job uses `verify-final` with trusted `VALIDATION_PLAN_MODE` and successful
`VALIDATION_EXECUTION_RESULT` job outputs. It verifies the original portable
record against independently reconstructed authority and rereads protected
health. These are hosted commands, not local substitutes for authenticated CI.
The five required validation contexts retain their existing names.

CI's separate `athena.validation-ci` gate uses identity `athena-validation-ci/v1`.
Only JSON under `artifacts/validation-ci/` is its review/record-neutral transport;
the verified record is transported as `artifacts/validation-ci/delivery-record.json`.
Cold verification derives the native candidate-keyed record path with the public
`deliveryRecordPathFor` API and a fresh CI candidate capture, then verifies those
original bytes. This does not make source, reports, telemetry, arbitrary HEAD
changes, or the delivery gate neutral.
Cold verification consumes the original portable record, not a locally rebuilt
attempt store or an uploaded summary's success claim.

The [health workflow](../.github/workflows/athena-validation-health.yml) runs on
the default branch daily at 14:00 UTC and by manual dispatch. It forces fresh
execution of the complete inventory and retains `health.json` as the
`athena-validation-health` artifact. Dispatch a new run; GitHub reruns are refused.
Health must be authenticated and fresh under the declared policy. Missing,
stale, unavailable, or relevant failing health requires full validation or
refuses admission; it never supplies permission to skip checks.

The hosted full-health command is `bun run harness:validation-ci -- health`.
`--bootstrap` applies only to genuinely empty history. For unavailable prior
history, the explicit hosted recovery command is:

```sh
bun run harness:validation-ci -- health --recover-unknown-history
```

Use the workflow's corresponding `recover_unknown_history` dispatch input to
supply the authenticated environment. Recovery retains unknown history as a
repository-wide finding; a fresh green run does not erase prior failures.
Known findings and approved classifications remain cumulative. Global closure
requires the protected approval and revalidation protocol, not an edited digest.

The selection guard binds `ATHENA_VALIDATION_HEALTH_REVISION` into native
evidence. Final admission cannot relabel an old proof with a later revision.
Candidate repair requires matching candidate, profile, finding revision and
health revision; a partial unit slice is not proof of a complete health check.
Candidate admission, hosted execution, and approved global closure are separate
facts. See [final health admission](../scripts/harness-validation-ci-admission.ts)
and [health authority](../scripts/harness-validation-health.ts).

Isolated checks use `delivery:telemetry-artifacts-check` to validate changed
product JSON against `refs/delivery/base`; they do not inspect a host run store.
The local delivery gate retains its live telemetry obligation. The final hosted
verifier also requires the current delivery export on the original authenticated
candidate before publishing successful required contexts. Artifact integrity
alone cannot establish delivery completion.

Private snapshots expose the captured base as `refs/delivery/base`. A hosted
caller may identify that base by SHA, so checks cannot assume `origin/main`
exists. The characterized report and inferential-review commands receive an
explicit `--base refs/delivery/base`; changed-file lint receives its existing
base-ref environment option. The adapter preserves the authored scripts and
binds the resulting execution commands in native configuration. Unrecognized
command shapes are not rewritten, and changed root script definitions refuse
the characterized projection until qualified.

### Operator Walkthrough Evidence Before Activation

These are the required qualification exercises, not claims that they have run.
The integration owner must retain actual commands, candidate/release bindings,
plans, native attempts, phase exits, final records and hosted run links:

| Exercise | Required observation |
| --- | --- |
| Refresh a report after a passing application gate | Replan with native capture; rerun the canonical lifecycle. Report/publishing obligations update, unrelated application attempts reuse where qualified, and the final record verifies. |
| Repair a late failed check | Keep unaffected valid successes; rerun the failed scope. The original failure and a tampered record must both refuse admission. |
| Move the base or change installed generation/policy | Reprepare and recapture complete base/candidate inventories. Retain actual invalidation or explicitly qualified compatibility; deleted base consumers cannot disappear. |
| Make health unavailable | Retain the typed reason; run the hosted full-health recovery above. Known failures and unknown history remain visible, with truthful credential coverage. |
| Repair a candidate while a global finding stays open | Bind the proof to the exact candidate/profile/health revision and complete check inventory. Demonstrate candidate admission without falsely closing the protected finding. |

V26-2071 additionally requires the finite injected-fault corpus, at least three
matched timing samples for representative expensive cases including setup and
health cost, actual hosted lifecycle and health seed/cold read, all five required
contexts, current review/gates, and a force-full rollback demonstration. Publish
activation wording and policy together only after that evidence is complete.

### Activation PR Checklist

This is the standing-policy delta for V26-2071, not a claim that the default has
changed. Apply it in the reviewed activation PR after the preceding qualification
requirements pass. Keep the qualification fixture's original bindings when the
delivery candidate changes; reprepare and let the product evaluate freshness.

| Authored location | Change together with executable activation |
| --- | --- |
| Root `AGENTS.md`, validation ladder | Replace opt-in/legacy-default language with affected validation as the default for qualified scopes. Retain exact membership, conservative fallback, preparation, independent review, `pr:athena`, and pre-push verification. |
| `packages/AGENTS.md`, shared validation guidance | State that the affected executor supplies default validation obligations through `pr:athena`; product-owned reuse does not replace review or the delivery gate. Preserve full-health floors. |
| Both webapp `docs/agent/testing.md` introductions | Replace opt-in language and link the actual default and recovery procedure here. Name only profiles qualified and enabled by the final configuration; exploratory execution alone does not enable a profile. |
| This guide's legacy deduplication paragraph | Describe it as the legacy fallback path rather than the default path. |
| This guide's affected-validation introduction | State the activated scope and link immutable release, hosted, corpus, timing and rollback evidence. Preserve existing anchors or update every caller. |
| This guide's local mode instructions | Document the exact configured default and supported overrides. Current local health accepts `comparison` and `full-health`; do not invent `ATHENA_VALIDATION_MODE=delivery` from the planner's separate mode vocabulary. |
| This guide's hosted qualification instructions | Replace manual-only routing with the actual automatic PR trigger and retained explicit fallback. Preserve pinned-base guard and cold-verification authority. |
| The walkthrough table above | Link completed exercises and their release/candidate/health bindings, and retain the recovery instructions. Record actual sample counts, setup/health costs, contention and remaining conservative fallback boundaries. |
| This guide's admission table | Describe selected native obligations plus live protected-health admission rather than the monolithic legacy review provider as the whole default gate. Preserve accepted contract, review, telemetry, record and pre-push obligations. |

The coupled executable changes are:

1. In `harness.config.ts`, intentionally select the qualified scoped runtime by
   default and preserve a force-full override. Keeping the existing runtime mode
   names avoids adding a new mode contract; any new name must be qualified across
   local health, native execution and CI, not merely added to an allowlist.
2. In `.github/workflows/athena-pr-tests.yml`, enable the affected job for ordinary
   PR events and update all five required-result projections and the
   inferential-only condition consistently. Changing the dispatch input default
   alone does not activate PR routing. Retain explicit legacy fallback, the
   independent guard, required context names and failure propagation.
3. Update `scripts/harness-validation-ci.ts` help when its legacy-authority claim
   ceases to be true. Keep help, commands, workflow callers and documentation
   consistent; renaming the existing `qualify` command is not required.
4. Demonstrate and document force-full execution with
   `ATHENA_VALIDATION_MODE=full-health bun run pr:athena`, using the same mode for
   that run's preparation and freshness/admission checks. Review and telemetry
   remain required. This is distinct from protected global health recovery via
   `health --recover-unknown-history`, which does not erase existing findings.
   Also retain an explicit legacy switch or document and test the reviewed
   policy/workflow revert for global rollback. Once scoped mode is the default,
   unsetting the environment variable is not a rollback. Prove broad execution
   and refusal of incompatible scoped records in the rollback exercise.

Refresh generated guides through their owner and reconcile affected solution
guidance through the compounding workflow. Historical dated evidence keeps its
original qualification boundary. Merge and root alignment follow the normal
delivery contract; this checklist authorizes no application deployment.

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
| `bun run delivery:telemetry-artifacts-check` | Validate changed product JSON in an isolated snapshot against its declared `refs/delivery/base`. |
| `bun run reports:presentation:check` | Presentation contract for every `docs/reports/*.html`. |
| `bun run docs:links:check` | Cross-references in `docs/solutions/**/*.md` resolve to servable docs. |
| `bun run graphify:check` | Freshness gate for tracked graphify artifacts. |
| `bun run graphify:rebuild` | Repair path for stale graphify artifacts. |
| `bun run pre-push:review` | The pre-push gate; also runnable by hand. |
| `bun run pr:athena` | The full delivery ladder (see phases below). |

`harness:test` selects `.test.ts` files from the top level of the repo-root
`scripts/` directory only. The scan is non-recursive, so nested trees — including
cloned worktrees under `worktrees/` — are never picked up. Use
`bun run harness:test --dry-run` to print the selected files without running
them.

A validation plan can declare exact root-test membership with repeated
`--test-file scripts/<name>.test.ts` arguments. Omission retains the complete
suite; an explicit empty, missing, nested, or symlink selection is refused.
For example, `bun run harness:test --test-file scripts/harness-test.test.ts`
runs only that file. Selected execution accepts `--timeout <milliseconds>`
after `--`, but refuses other runner arguments that could change membership.
`--dry-run` prints the same validated selection without executing it.

For package unit checks, the integration's exact-membership runner uses
`node ../../scripts/harness-vitest-membership.mjs --test-file src/<name>.test.ts`
from the package directory. It loads the existing Vitest configuration, discovers
configured test specifications, and executes only exact matching paths. Vitest's
ordinary filename arguments are substring filters, so they cannot establish this
membership guarantee. The operator profile passes `--max-workers 4`; storefront
inherits its configured default. The command projection refuses an authored test
script it has not characterized. Node matches Vitest's executable runtime; Bun
remains the repository's package manager. This runner does not activate affected
validation or replace the current delivery gate on its own.

The repo pins Bun through `packageManager` in `package.json` (`bun@1.1.29`
today). Every GitHub Actions job sets up Bun with `bun-version-file: package.json`,
so CI and local harness runs read the same declared version.

### Delivery Ladder Phases

The following describes the default legacy delivery path. The opt-in qualification
path above does not change these delivery requirements.

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
