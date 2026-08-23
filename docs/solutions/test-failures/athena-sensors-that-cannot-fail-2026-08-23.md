---
title: Sensors That Cannot Fail
date: 2026-08-23
category: test-failures
module: athena-webapp
problem_type: test_failure
component: testing_framework
symptoms:
  - "A test passed while the behavior its name described was absent."
  - "A characterization fixture pinned the wrong scale and hid a second defect on the same code path."
  - "A boundary test was green because it never scanned the directory the code had moved into."
  - "A negative assertion raced awaited work and failed only under CI timing."
root_cause: test_isolation
resolution_type: test_fix
severity: high
tags: [testing, sensors, falsification, characterization, boundary-tests, flaky-tests]
delivery_diff_fingerprint: d7fd2899aef7bfa3ba61870a898a05e529fd780ea0a43c62977238b356a738dd
---

# Sensors That Cannot Fail

## Problem

Across the V26-1312 platform-hygiene epic and its follow-ups, five separate green
sensors were discovered to be incapable of failing on the thing they existed to
catch. None of them was broken in a way any gate could see: they ran, they
passed, and they reported success. The delivery gate, the full 9,900-test suite,
typecheck, lint, and the architecture check were all green over code that a
sensor was silently not covering.

Every one was found by a human-directed adversarial pass, not by the harness.
The cost was real: one of them, a completion flag gating a money-validator
constraint flip, could have authorized flipping validators against unconverted
production rows.

## Symptoms

- A migration test named `keeps an applying batch from reporting zero work left
  before it is done` asserted only `{complete, migrated}` — the stored
  `remaining` was `0` with three rows unconverted, and the test passed.
- A registry test named `covers every package directory exactly once` asserted
  only uniqueness among *registered* directories. A planted
  `packages/zzz-fake-pkg` left it green while the real enforcement elsewhere
  correctly flagged it.
- A characterization fixture used `items: [{ price: 1500 }]` against
  `amount: 150000` — line items 100x smaller than the order containing them.
  The fixture was internally inconsistent, so it pinned a units bug in one
  direction while hiding a worse one: on realistic data, percentage discounts
  inflated 100x, and the `Math.min` clamp meant to cap a fixed-amount discount
  at the eligible subtotal stopped holding. The clamp itself was sound: on
  stored data both operands are pesewas, so `Math.min(200000, 150000)` compared
  like units and correctly returned the subtotal. What broke it is that the
  `isInCents` ×100 was applied to the clamp's *result*, and `OrderSummary`
  multiplied by 100 again — a GH₵1,500 order rendered a GH₵15,000,000 discount
  and an amount paid of −GH₵148,500. The cap bound and was then destroyed
  downstream; it was never a mixed-unit comparison. The numbers on inconsistent
  scales were the fixture's own — `Math.min(20, 1500)`, cedis-scaled operands
  sitting next to a pesewas `amount` — which is precisely why the destroyed cap
  never showed up in the assertion.
- `findIllegalConvexImports` walked `dirname(import.meta.url)` and so scanned
  `src/` only — never `shared/`, the directory ten browser-safe modules had just
  been moved into by the very ticket that tightened the boundary.
- `await waitFor(() => expect(ingest).toHaveBeenCalled())` followed by
  `expect(store.markEventsNeedsReview).not.toHaveBeenCalled()` passed locally and
  failed on CI. The awaited call was the *first* of a retry chain that
  dead-letters at a failure threshold, so the negative assertion was racing the
  retry.

## What Didn't Work

- **Reading the test name.** Three of the five read as though they covered the
  behavior. A name is a claim about coverage, and claims are not evidence.
- **Trusting a green full suite.** 9,927 tests passed on a tree where a stored
  `remaining` was lying and a boundary was unscanned.
- **Grep for the racy pattern.** A static scan of `src/lib/pos/**` found far
  more `waitFor`-then-negative candidate sites than could be triaged by eye —
  and no reproducible number: the total swings by hundreds depending on how the
  pattern is defined, so it is not a finding, only an order of magnitude. The
  count says nothing about which sites are genuinely racy either. Exactly two
  were, and the timing-parity sensor found both; every other candidate was
  sound.
- **Coverage instrumentation as a proxy for CI timing.** The CI failure appeared
  under `test:coverage`, so coverage looked like the reproduction lever. It is
  not: 8/8 green locally under coverage, and still green under 24 competing
  busy-loop processes. Coverage was correlated with the failure, not causal.

## Solution

Falsify every sensor against the defect it claims to catch. Concretely, for each
class:

**Tests.** After a fix is green, re-break the production code and confirm the
test returns red. If it does not, the test does not cover the fix.

```
# restore the bug, run the test, expect failure, then restore the fix
- const complete = !dryRun && page.isDone && startedAtBeginning && totals.pending === 0;
+ const complete = !dryRun && page.isDone && totals.pending === 0;
# → AssertionError: expected true to be false
```

**Characterization fixtures.** Check the fixture is internally coherent before
trusting what it pins. Units and scale must agree across every field of the same
object; a fixture whose line items cannot sum to its own total is describing a
system that does not exist, and will pin fictional behavior.

**Boundary and coverage scanners.** Add an anti-vacuity assertion: each
configured scan root must yield more than zero files. A rename that empties a
root then fails the sensor instead of leaving it green.

```ts
// every configured directory must actually contain scannable source
for (const dir of BROWSER_SOURCE_DIRECTORIES) {
  expect(collectSourceFiles(dir).length).toBeGreaterThan(0);
}
```

Then plant a real violation in *each* scanned root and confirm the scanner names
it. Also enumerate the specifier forms a regex-based scanner can miss: path
aliases (`@cvx/*` here, a genuine bypass of a rule that only matched `~/convex/`
and relative paths), dynamic `import("x")`, and side-effect `import "x"`.

**Racy negative assertions.** Wait for the *settled* state, not the first
observable event. Where a retry chain can perform the negative-asserted work,
freeze the chain — let only the first attempt fail and park every retry — so the
escalation cannot fire behind the assertion.

**Local/CI parity.** When CI runs a sensor local validation cannot, that is a
parity gap by definition. Reproduce the *cause*, not the correlate: here, timer
callbacks landing late relative to microtask work. Scaling `setTimeout` and
`setInterval` by 10x reproduced the verbatim CI failure 5/5 in 71 seconds, where
coverage never reproduced it in 15 minutes. That sensor then found a *second*
genuinely racy test that grep could not distinguish from the sound candidates.

## Why This Works

A sensor's value is exactly the set of defects that make it fail. That set is
unobservable from a passing run — a test that cannot fail and a test whose
subject is correct produce identical output. The only way to measure it is to
introduce the defect and watch.

This also explains why the failures clustered where they did. Each sensor was
written alongside the fix it validates, by the same author, in the same session
— so the author's misunderstanding is encoded identically in both. The fixture
with 100x-inconsistent scale, the test name that outran its assertions, and the
scanner that missed the directory the code had just moved to are all the same
error: the sensor inherited the blind spot it was meant to guard.

Falsification breaks that symmetry because it asks a different question. Not
"does my code do what I think?" but "would I find out if it didn't?"

## Prevention

- Falsify every new or changed test before committing it: re-break the code,
  confirm red, restore. Report the red output in the handoff so a reviewer can
  check the sensor, not just the fix.
- Treat a test name as an assertion. If the name says "does not report zero work
  left", the test must assert on the reported value.
- Give every directory-scanning sensor an anti-vacuity guard and one planted
  violation per scan root.
- When adding a rule to a regex-based scanner, enumerate the alias and import
  forms that dodge it, and pin each with a fixture.
- Never pair `await waitFor(<positive>)` with `expect(...).not.toHaveBeenCalled()`
  when the awaited work can trigger the negative. Run
  `bun run --filter '@athena/webapp' test:timing-parity` to find these; it scales
  timers by `ATHENA_TEST_TIMER_LAG` (default 10) and is registered in the
  validation map for POS local sync and the frontend test harness.
- When a sensor only fails remotely, reproduce the mechanism before believing any
  hypothesis about it, and treat the local gap as its own defect.

## Related Issues

- [Terminal operational state aggregate](../architecture/athena-terminal-operational-state-aggregate-2026-06-27.md) — the deleted frontend fallback in the same epic had rotted unnoticed for the same reason: nothing could fail when it drifted from server policy.
- [Source transition operational work reachability](../architecture-patterns/athena-source-transition-operational-work-reachability-2026-08-22.md) — the epic's other durable rule.
- [Money inputs and minor units](../logic-errors/athena-money-inputs-minor-units-2026-04-23.md) — the units contract the inconsistent fixture violated.
