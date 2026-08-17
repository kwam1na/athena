---
title: Verify the Fix — Three Rounds Where the Previous Round's Fix Was the Defect
date: 2026-08-17
last_updated: 2026-08-17
category: docs/solutions/workflow-issues
module: Delivery workflow, code review
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A review round produces fixes that are themselves shipped without independent re-review"
  - "A regression test is written for a bug that was just fixed"
  - "A security guard compares two values and you have not asked where each one came from"
  - "A static check enumerates bad shapes rather than accepting one good shape"
tags: [code-review, testing, security, review-loop, regression-tests, static-analysis]
delivery_diff_fingerprint: 5167c7723d2b8601fcecba71a88c44d0fe5815019da794f0763120af1db5d05d
---

# Verify the Fix — Three Rounds Where the Previous Round's Fix Was the Defect

## Problem

On one large delivery (`V26-1239`, the operation-admission migration), three
consecutive independent review rounds each found that **the previous round's fix
was itself the defect**. Not a new area, not a missed case — the fix.

| Round | What the fix did | What the next round found |
|---|---|---|
| Closure | Bounded the HTTP ingress body inside the rail | The rail now read `c.req.raw.body` directly while two webhook middlewares had already consumed it — **every genuine webhook would have been denied** |
| 1 | Bounded the guest→account merge by "possession", comparing the body's guest id to the `guest_id` cookie | A cookie is caller-supplied: **both operands came from the same request**, so it bounded nothing and the exploit precondition was unchanged |
| 2 | Replaced it with a server-issued grant minted at sign-in | The mint read the **raw** `guest_id` cookie, so an attacker presenting a victim's id while signing in to their own account still got the grant |

Each fix was reviewed by its author, believed correct, and shipped with comments
asserting a guarantee it did not have. Each was caught only by an independent
reviewer with an adversarial brief.

## Solution

Three practices, in order of how much they caught here.

### 1. Re-review the fixes, not just the original change

A fix is new code written under time pressure, usually in the area the reviewer
just proved you were reasoning about incorrectly. It deserves the same scrutiny
as the code it replaces — a partial follow-up on the changed files is not
enough, because the fix's defect is often in the *interaction* the diff does not
show. Every round here found its defect in an interaction: a middleware and a
rail both reading one stream; two operands with the same provenance; a mint site
trusting an input the checker downstream had stopped trusting.

### 2. Revert the fix and watch the test fail

A regression test that has never been observed failing is a guess. Two on this
delivery passed with their fix removed:

```ts
// PASSED with the fix reverted — the harness returned 500 for an unrelated
// reason, and 500 is "not 403".
expect(response.status).not.toBe(403);

// PASSED with the fix reverted — the buggy code wrapped the error but kept
// `message`, and the assertion only inspected `message`.
await expect(run()).rejects.toThrow("index missing");
```

Both were written *by the author of the fix*, immediately after fixing it, in a
delivery whose entire subject was checks that pass for the wrong reason. The
cost of the check is one `git stash` and one test run:

```
# with fix   → green
# fix reverted → MUST be red
# restored   → green
```

Assert **identity or an observable**, not a proxy: `toBeInstanceOf(TypeError)`
over a message match; "the reader stopped pulling at 1 MiB" over "the response
was 413" when both codepaths return 413.

### 3. For a guard, ask where each operand came from

The merge guard read `claimGuestId === currentOwner` and looked like a bound. It
was not: trace each operand and both arrive on the attacker's request. Write the
provenance down at the guard:

```ts
// currentOwner: request body        (caller-supplied)
// claimGuestId: guest_id cookie     (caller-supplied)  <-- not a bound
// grant:        guest row, written by the server at authenticated sign-in  <-- a bound
```

A guard comparing two caller-supplied values proves only that the caller can
type the same string twice. The fix is always a value the server issued and can
look up — not one the request carries.

### Corollary: prefer a whitelist grammar to a blacklist of bad shapes

The static checker on this delivery was defeated in three consecutive rounds,
each by a novel expression form its blacklist did not enumerate (a const-bound
wrapper, work hidden in call arguments, an IIFE argument, a path-suffix module
match). Enumerating bad shapes is unbounded; accepting exactly one good shape is
finite. When a check guards something that matters, define the grammar it
accepts and reject everything else — then a novel shape fails closed instead of
slipping through.

## Why This Matters

The expensive failure is not the bug. It is that **each fix shipped with a
comment asserting the guarantee it lacked** — "they hold no such cookie", "no
request-supplied id can select another shopper's row". A wrong comment is worse
than no comment: it stops the next reader looking. Two of the three rounds above
were found *despite* such a comment, by a reviewer who checked the code instead
of reading the claim.

State what a control does **not** buy, next to the control:

```ts
/**
 * WHAT THIS DOES AND DOES NOT BUY:
 *  - It ends "any signed-in shopper may absorb any guest id at any time".
 *  - It does NOT make a guest id unguessable, and does NOT stop someone who
 *    knows one from presenting it while signing in to their own account.
 *    That residual is tracked in <ticket>.
 */
```

## Prevention

- Re-run the **complete** reviewer set after review fixes, against the new
  candidate. Budget for it: on this delivery it was three full rounds.
- Treat "I wrote a regression test" as unfinished until the test has been
  observed red without its fix. Say so in the report.
- At any guard, write each operand's provenance in a comment. If two are
  caller-supplied, it is not a guard.
- Prefer a whitelist grammar over a blacklist for checks that gate merges.
- When a control has a residual, name it at the control and file the ticket —
  not only in the ticket.

## Related

- [Completing an Admission Rail — Deriving Invariants Instead of Listing Them](../architecture-patterns/athena-complete-operation-admission-migration-2026-08-16.md) — the delivery these came from.
- [Reconciling divergent WIP read contracts, not deletions](reconciling-divergent-wip-read-contracts-not-deletions-2026-07-23.md) — the companion lesson that intent is recorded somewhere and inference is a last resort.
