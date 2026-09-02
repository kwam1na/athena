---
title: Retire a pinned characterization sensor in its own candidate before the subject it pins moves
date: 2026-09-01
category: harness
module: delivery-harness-policy
problem_type: tooling_decision
component: tooling
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A sensor pins a byte digest, a hardcoded path set, or a release id over something a planned migration is about to replace"
  - "A planned cutover would turn a green suite red for reasons that are correct-by-construction rather than defects"
  - "Removing a sensor also removes the only mechanical detection of drift on some path, and someone must decide whether to accept that residual"
tags: [delivery-harness, characterization-sensor, pinned-digest, sensor-retirement, deletion-candidate, coverage-floor]
delivery_diff_fingerprint: dad7735c7be45b8c463dc1c0a397bebac152c64835d96065b6efb8bd9077e880
---

# Retire a pinned characterization sensor in its own candidate before the subject it pins moves

## Problem

A characterization sensor earns its keep by pinning something exactly: a byte
digest over a tracked layout, a hardcoded list of required normative sources, a
release id. That exactness is the whole value while the subject holds still. It
becomes a liability the moment a plan decides the subject should move.

Athena hit this at the boundary of a planned projection swap. Two landed sensor
families pinned the vendored agent-skill layout that the swap exists to replace:

- the shadow-discovery guard pinned a byte digest over the vendored discovery
  layout and asserted the projection was scoped to managed delivery worktrees;
- the portable-baseline characterization sensor hardcoded
  `.agents/skills/track` and `.agents/skills/execute` as required normative
  sources and bounded-closure members, and its checker rejected symlinked
  members and inventory symlinks — exactly the shape a projection introduces.

Two adjacent sensors, the portable canary and batch adoption checks, pinned the
`core` release id and would go red on the profile switch.

The failure mode this creates is subtle. At the swap, `bun run harness:test`
goes red — but every one of those failures is the sensor correctly reporting
that its pinned subject changed. The tempting response is to re-pin the digest
or repoint the paths inside the swap candidate. That is the wrong move twice
over: it buries a deliberate architectural change inside a digest bump, and it
leaves a sensor whose contract no longer describes anything real. The honest
options are to retire the sensor or to rewrite its contract, and neither one
belongs in the same candidate as the change that forced the question.

## Solution

Retire the sensor as pure deletion, in its own candidate, landing before the
change that would have broken it.

Sequence that worked:

1. **Characterize first, on the untouched tree.** Run the repository sensors
   green before deleting anything, and record the numbers. Here: `harness:test`
   at 1799 passing across 77 files, and each retiring sensor run individually so
   its green output is on the record rather than inferred.
2. **Close the import graph before deleting.** `grep -rn` every file in the
   delete set for inbound references. The set is safe to remove only when its
   importers are all inside the set. Check package scripts, CI workflow steps,
   harness registries, and blocker inventories too — a dangling package script
   fails a gate just as loudly as a dangling import.
3. **Delete exactly the enumerated set.** No adjacent cleanup, no repointed
   tests, no lowered floors.
4. **Touch shared records only where the deleted code owned or read them.** The
   activation record here lost precisely two things: the ownership pointer to
   the deleted guard, and the managed-worktree scope rule the guard enforced.
   Everything else stayed, because a policy record is history as much as it is
   configuration, and rewriting history to tidy a deletion destroys the audit
   trail the record exists to hold.
5. **Prove the floors rather than assume them.** Deleting code changes coverage
   ratios in whichever direction the deleted code's own coverage happened to
   run. Measure against the pinned floors and report the actual numbers.
6. **Leave the historical records alone.** Baselines, overlay maps, migration
   records, and prior reports keep referring to the retired sensor. That is what
   a historical record is for. A note like this one carries the supersession
   forward instead.

## Why This Matters

Separating the deletion from the swap keeps two different kinds of review
possible. A pure-deletion candidate is reviewable as "does anything still
reference this, and did the floors hold" — mechanical, fast, and hard to get
wrong. The swap candidate is then reviewable as an architectural change on its
own merits, with no digest churn mixed in. Bundled together, each hides the
other, and the reviewer's only available verdict is "the suite is green," which
is precisely the signal that was engineered away by re-pinning.

The residual matters too, and it is not the executor's to accept. Retiring a
characterization sensor removes real detection capability — here, the only
mechanical detection of unreviewed change under the agent-skill and agent
definition paths. When the repository has no required-review rule to fall back
on, that capability is replaced by operator practice, not by another gate. Name
that consequence explicitly and get the decision recorded on the ticket before
the deletion lands. An executor performs the deletion; it does not decide that
the residual is acceptable.

## Prevention

- When a plan proposes moving something a sensor pins, schedule the sensor's
  retirement or rewrite as its own ticket, sequenced before the move. Do not let
  it surface as a surprise red suite inside the moving candidate.
- Treat "re-pin the digest so the suite goes green" as a review finding, not a
  fix, unless the re-pin is itself the deliberate reviewed change.
- Before deleting a script family, close its import graph and grep the package
  scripts, CI workflow steps, and harness registries — the compiler only catches
  the first of those.
- Run coverage against the pinned floors after a deletion and report real
  numbers. Never lower a floor to absorb a removal; if a floor breaks, that is a
  finding for an operator, not a value to edit.
- Expect a large pure deletion to trip the repository's documentation gates.
  `compound:check` and `landed-report:check` count additions plus deletions, so
  a deletion-only candidate clears their thresholds and demands the same
  solution note and landed-change report a feature would.

## Examples

Closing the import graph before deleting, which is what makes the deletion
mechanical rather than exploratory:

```bash
# Every inbound reference to the delete set, minus the set's own internal ones.
grep -rn "from \"./portable-baseline\|from \"./portable-canary\|from \"./portable-batch\|from \"./shadow-discovery" scripts/*.ts \
  | grep -v "^scripts/portable-baseline\|^scripts/portable-canary\|^scripts/portable-batch\|^scripts/shadow-discovery"
# No output: the set only imports itself and is safe to remove whole.
```

The floors, measured rather than assumed. A deletion moved repo-scripts line
coverage from its pinned floor of 57.76% up to 62.55% and functions from 88.07%
up to 89.86% — the removed code was less covered than the average, so the ratio
improved. It could as easily have gone the other way, which is the reason to
measure.

## Related

- `docs/solutions/harness/shadow-window-preconditions-managed-projection-scope-2026-08-30.md`
  introduced the shadow-discovery guard and the byte-neutrality position. This
  note supersedes its runnable-command section: the guard and its suite are
  retired, so the commands that note lists no longer exist. Its reasoning about
  why the shadow window needed byte-neutrality remains the historical record of
  that decision.
- `docs/solutions/harness/the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md`
  on reading a green suite as evidence of a bounded claim rather than of safety.
