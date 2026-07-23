---
title: Reconciling a Divergent WIP — Find the Author's Intent Record Before Inferring It From the Diff
date: 2026-07-23
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - Reapplying a large WIP stash or long-lived branch onto a moved main
  - Code appears missing after a merge and you are deciding whether it was deliberate
  - Tests fail after a refactor and the assertions look like they contradict the change
  - A cross-cutting refactor was validated with name-filtered test runs
tags: [git, stash, merge-conflict, operation-admission, shared-demo, intent-inference, test-mocks]
delivery_diff_fingerprint: 55afb12f81bbb232c05aefebc7356dc231e07870dd80cf99f58668237c7f49dd
---

# Reconciling a Divergent WIP — Find the Author's Intent Record Before Inferring It From the Diff

## Problem

A ~90-file WIP stash was reapplied onto `main` with `git stash pop`. Eight files carried
conflict markers. More consequentially, roughly eleven convex modules were missing their
shared-demo admission blocks with **no** conflict marker, and the full suite showed 18
failures whose assertions described behavior the source no longer had.

Everything downstream depended on one question — *were those deletions deliberate?* — and
that question was answered wrong three times before anyone read the record that answered it
directly.

## Symptoms

- Missing code with no conflict marker anywhere.
- Test assertions that appear to contradict the source, including assertions the WIP's own
  author had written.
- A resolution policy ("prefer the branch", "prefer main") that produces contradictions no
  matter which way it is applied.

## What Didn't Work

- **"Stale base — the stash pop reverted merged work."** Disproved by one command:
  `git rev-parse 'stash@{0}^'` → `5bc2f7ff`, which *already contained* the admission work.
  The theory was built from the shape of the failures instead of the commit graph.

- **"It's branch-versus-main preference."** Applying "prefer the branch" produced 18 failures
  across 8 files, five of which the branch had never touched. A blanket policy assumes each
  side is internally consistent; this one wasn't, and that inconsistency was treated as a
  reason to push harder rather than as a signal the premise was wrong.

- **"The WIP is incoherent — its own tests contradict its source."** The most persuasive
  wrong answer. A test the author wrote asserted
  `expect(requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled()` while the source
  called exactly that function. This looked like proof of a half-finished refactor. It was
  a **mechanism assertion invalidated by a legitimate consolidation** — see below.

- **Reaching for the mocks to make failures pass.** Available at every stage and always
  wrong-looking-right. Whether it is repair or laundering depends entirely on the diagnosis
  that precedes it, which is why the diagnosis has to be evidence-backed first.

## Solution

**Read the author's own record.** The work came from a Codex session whose transcript was
on disk the whole time:

```bash
grep -m1 "<thread-id>" ~/.codex/session_index.jsonl        # find the thread
ls ~/.codex/sessions/YYYY/MM/DD/rollout-*<thread-id>.jsonl # the transcript
# extract just the human turns — the intent, without the 45MB of tool traffic
python3 -c "
import json
for line in open(PATH):
    d = json.loads(line); p = d.get('payload') or {}
    if d.get('type') == 'event_msg' and p.get('type') == 'user_message':
        print(p.get('message','')[:300])
"
```

The operator's instruction was explicit:

> "that's legacy and old behavior. all sites need to be on the new rails. let's change and
> then remove that function"

The deletions were the assignment. The refactor routed per-site admitted-user resolution
into the shared helper, which already short-circuits on admission:

```js
// lib/storeMemberAccess.ts — before: the branch duplicated at every call site
const athenaUser = demoActor !== null
  ? await ctx.db.get("athenaUser", demoActor.athenaUserId)
  : await requireAuthenticatedAthenaUserWithCtx(ctx);

// after: one call; lib/athenaUserAuth.ts does the admission short-circuit centrally
const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
```

`demoActor` is still computed and returned — actor-kind reads that do real work (capability
checks, scope checks) stayed. Behavior is identical; only the call shape changed.

**Then classify every failure as behavior or mechanism.** All 18 failed for one reason:
each file does `vi.mock("../lib/athenaUserAuth")`, replacing the very function the
resolution was consolidated *into*. The mock made the short-circuit unreachable. Nothing
regressed in production.

The fix is to move the test harness toward the refactor — make the mock admission-aware, and
replace each call-shape assertion with the guarantee it stood for:

```js
// mechanism — cannot survive consolidation, and should not
expect(requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();

// behavior — what that line actually protected
expect(requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
  expect.objectContaining({ operationAdmission: expect.objectContaining({
    actor: expect.objectContaining({ athenaUserId: "demo-user-1", kind: "shared_demo" }) }) }));
expect(requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalledWith(
  expect.anything(), expect.objectContaining({ userId: FALLBACK_AUTH_USER_ID }));
```

Every replacement must be falsified: break admission deliberately and confirm the new
assertion fails. A replacement that passes under a break has removed coverage.

Note this is per-assertion, not per-file. In the same file, a sibling test's
`.not.toHaveBeenCalled()` remained correct — on demo *denial* the adapter throws before auth
is consulted, so the old shape still holds. The old style isn't universally wrong, only
where resolution now routes through the helper.

## Why This Matters

**Intent is recorded somewhere; inference is a last resort.** Four rounds of rework —
including restoring code, un-restoring it, and rewriting this note — were spent inferring
intent from a diff while the operator's one-sentence instruction sat in a local transcript.
When a WIP's intent is load-bearing, the session log is primary evidence and the diff is
secondary.

**Mocking a boundary couples tests to call shape.** A test that mocks the module a refactor
consolidates *into* will fail on a behavior-preserving change, and its failure reads exactly
like a real regression. The distinction between "this asserts what the system does" and
"this asserts how the code is arranged" is the whole skill.

**Name-filtered validation hides cross-cutting breakage.** Every check the original author
ran was `-t` filtered:

```
bun run test -- ... -t "shared demo|store member access|admitted POS local sync public mutation"
```

That is why the WIP looked green to its author. The six files that later failed contained no
matching test names, so they were never executed. A refactor that touches a shared helper
must be validated with the full suite; a filtered run proves only that the files you already
thought about still pass.

## Prevention

- Before diagnosing "the merge lost this," verify the base:
  `git rev-parse 'stash@{0}^'` and `git log --oneline <base>..origin/main`. If the commit you
  think was lost is an ancestor of the base, the deletion was deliberate.
- When a WIP's intent is unclear, look for the session transcript before reasoning from the
  diff (`~/.codex/sessions/`, `~/.claude/projects/`). Extract the human turns only.
- After any refactor of a shared auth/access helper, run the **full** suite. Never accept a
  `-t`-filtered run as validation for a cross-cutting change.
- When a test fails after a refactor, classify before editing: does it assert behavior, or
  call shape? Only call-shape assertions may be rewritten, and only into behavioral ones.
- Falsify every replaced assertion by breaking the thing it guards. Un-mock rather than
  fake the boundary when the fixture allows it.
- When a blanket resolution policy produces contradictions, treat that as evidence the
  premise is wrong, not as friction to overcome.
- Snapshot any verified-good state that exists only in the index before reworking it —
  an index-only state is unrecoverable once overwritten.

## Related Issues

- [Instrument the Live State Before Theorizing](athena-pos-gate-flash-instrument-before-theorize-2026-07-19.md)
  — the same failure mode: a confident theory from reading code, wrong until real state was captured.
- [Shared Demo Cross-Layer Polish](athena-shared-demo-cross-layer-polish-2026-07-22.md)
  — the shared-demo admission surface this work migrated onto the rails.
- PRs #689, #692 (operation admission rails), #694 (`admitSharedDemoPublicMutation` →
  `withOperationMutationAdmission` rename, which is why branch-era identifiers needed porting).
