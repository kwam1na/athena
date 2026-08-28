---
title: "Authoritative Characterization Requires Exact Semantics"
date: 2026-08-28
category: architecture-patterns
module: delivery-workflows
problem_type: architecture_pattern
component: testing_framework
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "A read-only baseline becomes the source for later extraction or migration work"
  - "Structured records can remain internally consistent while their meaning drifts"
  - "Review pressure risks growing a characterization sensor into a new framework"
tags:
  - "characterization"
  - "fail-closed"
  - "delivery-workflows"
  - "scope-discipline"
  - "semantic-contracts"
  - "mutation-testing"
delivery_diff_fingerprint: "6d000ac634d032e72eaf2f94c33f62ad9c42482b9f0b76f29a69917ad4737c29"
---

# Authoritative Characterization Requires Exact Semantics

## Problem

A characterization artifact can pass strong structural validation and still
certify the wrong thing. IDs may point to different valid paths, required edges
may become optional, a source citation may remain valid but unrelated, or two
mutable records may be changed together so their internal references still
agree. When later delivery units consume that baseline, structural
self-consistency turns semantic drift into an approved migration instruction.

The opposite failure is review-driven overgrowth: every hypothetical hardening
idea becomes another abstraction, parser, or filesystem policy even when it does
not change the promised outcome.

## Solution

Treat an authoritative characterization as two layers:

1. Keep source-derived facts in the committed baseline: content digests, tree
   counts, and discovered dependency evidence.
2. Keep the approved meaning in small declarative contracts: exact source
   identity, classification, required parity, scenario membership, and the
   human-readable text that downstream work will treat as authoritative.

Validate both directions. Every required contract item must appear exactly
once, and every authoritative artifact item must have a contract. For fields
whose combinations carry meaning, validate the whole tuple rather than each
enum independently. For example:

```text
source id -> canonical path + source kind
member id -> canonical path + kind + classification + optional note
dependency -> source + target + relation + requirement + parity
scenario -> exact assertion ids + exact classification ids
```

Prove each contract with mutation tests that first demonstrate a false green.
Change a value to another schema-valid value, add an extra valid item, remove a
required item, or rebind two related records together. The sensor is complete
only when those mutations fail for a named semantic reason.

Keep the implementation plain. Extend an existing table or remove an ambiguous
field before adding a generator or generalized validation layer. A review
finding belongs in the delivery only when it demonstrates a concrete wrong
certification against the ticket outcome.

## Why This Matters

Exact semantic contracts make the characterization useful to downstream agents
without pretending the checker can rediscover every policy decision from prose.
Source-derived digests still prove repository freshness, while small reviewed
tables prove the intended interpretation.

The simplicity boundary is equally important. Scope discipline prevents a
finite baseline ticket from becoming a universal repository validator. The
right finish line is not “reject every imaginable filesystem state”; it is
“reject every demonstrated way this baseline can certify a meaning the delivery
did not approve.”

## Prevention

- Start with characterization mutations, including coordinated edits that keep
  references internally consistent.
- Pin semantic tuples and ordered memberships, not only IDs or enum shapes.
- Keep discovered facts in the artifact and approved interpretation in concise
  contracts; do not duplicate source contents in code.
- Require exact scenario coverage when extra behavior would silently broaden the
  workflow.
- Reject a review suggestion that cannot name an observable contract failure;
  defer genuine expansion rather than folding it into the current ticket.
- After every source edit, prepare and independently review the exact candidate
  before recording merge evidence.

## Examples

Structural validation alone can accept this coordinated drift:

```text
alias A -> member B
dependency target -> member B
```

Both records agree, but the approved alias may have been `A -> member A`. An
exact tuple contract catches the semantic rebind without requiring a parser for
the entire source skill.

Likewise, an inclusion-only scenario check accepts an extra valid assertion.
Comparing the ordered approved membership rejects the scope expansion with one
declarative comparison.

## Related

- [Candidate-Bound Gate Obligations Before Expensive Validation](./candidate-bound-gate-obligations-before-expensive-validation-2026-08-11.md)
- [Review Findings Carry a Scope Axis, and Delivery Runs Leave a Durable Record](../harness/scope-disciplined-review-and-durable-run-telemetry-2026-08-13.md)
- Linear: V26-1412, V26-1413
