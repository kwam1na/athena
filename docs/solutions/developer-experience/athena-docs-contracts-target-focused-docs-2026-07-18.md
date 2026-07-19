---
title: Docs Contracts Should Target Focused Docs, Not README Prose
date: 2026-07-18
category: developer-experience
module: repo-harness
problem_type: documentation_gap
component: documentation
resolution_type: documentation_update
severity: medium
applies_when:
  - Adding a harness sensor or test that asserts documentation content
  - Splitting a large README into focused docs
  - A docs check fails because content moved to a different file
tags: [harness, documentation, readme, sensors, docs-contracts]
delivery_diff_fingerprint: fa8123077a676427973ee2f27b7527254d049c8729ddd7935943f85ecf1b3445
---

# Docs Contracts Should Target Focused Docs, Not README Prose

## Problem

The Athena README had grown to 334 lines, most of it harness and graphify
reference detail: command lists, artifact paths, proof status values, behavior
scenario names, and CI wiring. It read as an append-only changelog rather than
an overview, and a newcomer could not find the product description under it.

The growth was not merely editorial drift. Three harness contracts actively
required that detail to live in `README.md`:

1. `RUNTIME_SCENARIO_DOCS` in `scripts/harness-check.ts` listed `README.md` as a
   doc that must carry the runtime behavior scenario list, kept in sync with
   `scripts/harness-behavior-scenarios.ts`.
2. Two tests in `scripts/pre-push-review.test.ts` asserted roughly 25 **verbatim
   sentences** in `README.md`, such as
   `` "`bun run pr:athena:prepare` starts with that same generated-artifact repair step" ``.
3. Fixture repos in `scripts/harness-check.test.ts` and
   `scripts/harness-audit.test.ts` modelled the README as the scenario-list home.

Because the sensors pinned prose to the README, every new harness capability had
to append another paragraph there. Any attempt to slim the README failed
`harness:check`, `harness:audit`, and `harness:test`.

## Solution

Move the canonical reference into focused docs and **retarget the contracts to
follow it**, rather than keeping a duplicate list in the README.

- `docs/harness.md` gained a "Command And Artifact Reference" section: the
  repo-level command table, delivery ladder phases, inferential review modes,
  behavior scenarios, artifact paths, CI wiring, and Git hooks.
- `docs/graphify.md` is new and owns graphify commands, tracked vs ignored
  artifacts, and the Python runtime resolution order.
- `docs/deployment/vps-production.md` gained a `Prerequisites` section holding
  the access requirements that previously sat in the README.
- `scripts/harness-check.ts` now points `RUNTIME_SCENARIO_DOCS` at
  `docs/harness.md` instead of `README.md`.
- The two `pre-push-review.test.ts` docs contracts now read `docs/harness.md`
  and `docs/graphify.md`, and assert on **command and artifact tokens** rather
  than whole sentences. A new test asserts the README still links to each
  focused doc.
- Both fixture repos write a minimal `docs/harness.md` and `docs/graphify.md`,
  and a short README that links to them.
- `collectReadmeLinkErrors` now also requires the README to link
  `docs/harness.md` and `docs/graphify.md`. Without this, moving reference
  detail out of the README could leave it unreachable, and a renamed doc would
  leave a dead README link that no sensor caught.

The README is now 150 lines: what Athena is, an honest status table including
what is missing, setup, a documentation index, backend shape, the daily
operations vocabulary, and the delivery gates.

### Keep The Scenario Marker Under A `##` Heading

`extractRuntimeScenarioSection` scans from the scenario marker to the next
`^## ` heading; it does not stop at `###`. When the scenario list sat under a
`###` subsection, the scan ran to end of file and swallowed the artifact and CI
sections below it. Any backticked token there shaped like a scenario name
(`athena-*`, `storefront-*`, `valkey-*`) would then be reported as an unexpected
scenario.

`docs/harness.md` therefore keeps the list under `## Behavior Scenario
Reference`, immediately followed by `## Artifacts And CI Reference`, which
bounds the scan. Preserve that heading level when editing the doc.

## Why This Matters

A docs contract that asserts verbatim prose in a file makes that file grow
monotonically. Each capability appends a sentence, no sentence can be removed
without a test edit, and the file drifts from its actual job. Asserting on
tokens — command names, artifact paths, config keys — keeps the contract
meaningful while letting the prose be rewritten, condensed, or moved.

Pointing the contract at the doc that *should* own the content also makes the
sensor a statement of intent: "the harness doc is where runtime scenarios are
documented" is a more useful invariant than "the README mentions scenarios."

## Prevention

- When adding a docs sensor, target the focused doc that owns the topic. Reserve
  README assertions for links and orientation, not reference detail.
- Assert on tokens (`bun run harness:test`, `artifacts/harness-scorecard/`), not
  on sentences. If a test would break on rewording, it is too tight.
- When a docs check blocks a restructure, ask whether the sensor's target is
  still right before restoring content to satisfy it.
- Grounding matters: this restructure surfaced four inaccuracies that had been
  copied forward in the README — `maxPhaseDurationMs` is a per-phase map rather
  than a scalar, `artifacts/harness-delivery-runs/` was missing from the
  ignored-artifact list, `graphify-out/graph.html` is committed but outside the
  freshness gate, and `pr:athena` has five delivery phases rather than four
  (`preflight` was undocumented in `docs/harness.md`). Verify doc claims against
  the code before copying them into a new home.

## Examples

Before — the contract pinned prose into the README:

```ts
// scripts/harness-check.ts
const RUNTIME_SCENARIO_DOCS = [
  "README.md",
  "packages/athena-webapp/docs/agent/testing.md",
  ...
] as const;
```

```ts
// scripts/pre-push-review.test.ts
expect(readme).toContain(
  "`bun run pr:athena:prepare` starts with that same generated-artifact repair step",
);
```

After — the contract follows the content, and asserts tokens:

```ts
// scripts/harness-check.ts
// The canonical runtime scenario list lives in the harness doc, not the README.
// The README stays a short overview that links out to focused docs.
const RUNTIME_SCENARIO_DOCS = [
  "docs/harness.md",
  "packages/athena-webapp/docs/agent/testing.md",
  ...
] as const;
```

```ts
// scripts/pre-push-review.test.ts
const harnessDoc = await readFile(path.join(ROOT_DIR, "docs/harness.md"), "utf8");
expect(harnessDoc).toContain("pr:athena:prepare");
```

## Related

- [Repo harness and sensors](../../harness.md)
- [Graphify](../../graphify.md)
