---
title: Registry-Owned Harness Blockers Need Typed, Actionable Diagnostics
date: 2026-04-30
last_updated: 2026-08-22
category: harness
module: repo-harness
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "pre-push auto-runs harness:generate but still blocks on missing generated validation-map paths"
  - "Generated harness docs reference routes or components that were removed from the app"
root_cause: stale_harness_app_registry_entry
resolution_type: workflow_improvement
severity: medium
tags:
  - harness
  - generated-docs
  - validation-map
  - pre-push
delivery_diff_fingerprint: 78eb41793d125b28db3314495991d2df0508a7713f53540c87f4fc28d7776199
---

# Registry-Owned Harness Blockers Need Typed, Actionable Diagnostics

## Problem

Some harness drift is safe to repair by regenerating docs. Stale validation-map paths are different: the generated file can be fresh while its source entry in `scripts/harness-app-registry.ts` still points at a deleted route or component.

In that case, rerunning `bun run harness:generate` only reproduces the stale reference.

## Solution

Keep generated-doc auto-repair for missing or stale generated artifacts, but classify missing validation-map path prefixes as registry-source drift. The diagnostic should name the generated file, the missing path, and `scripts/harness-app-registry.ts` as the source to update before rerunning generation.

That source-specific diagnostic is now part of a broader harness blocker
contract. Harness commands create one typed `HarnessBlocker` in
`scripts/harness-blockers.ts`, then derive both bounded terminal guidance and
structured event payloads from that object. A blocker carries a stable code, a
typed source (`gate`, `obligation`, `provider`, `preparation`, `candidate`, or
`command`), a concise summary, optional sanitized details, and at least one
typed remediation. Command remediations store an argument array instead of a
shell-formatted string, so automation can inspect or execute them without
having to parse human output. The renderer never executes that guidance;
existing workflow authorization still decides whether an action may run.

This preserves the original registry-owned diagnosis: a stale validation-map
path is not merely a failed command. Its blocker identifies the source that
owns the drift and supplies the narrow source edit plus regeneration command.
When several checks discover the same repair, the renderer deduplicates the
remediation by stable id while retaining every blocker and its provenance.
Gate-decision schema v2 carries that typed envelope exclusively. The former
string `findings` and `remediation.machine/human` decision projections were
removed so consumers cannot silently diverge from the terminal contract.

## Prevention

- When removing app surfaces, search `scripts/harness-app-registry.ts` for the path or parent validation scenario.
- Treat generated docs as outputs; update registry scenarios before regenerating them.
- Do not auto-delete registry entries unless the tool can prove the validation intent should disappear.
- Build new fail-closed harness paths with `createHarnessBlocker`; do not add a
  second free-form error convention.
- Render operator output with `formatHarnessBlockers` and serialize event output
  with `serializeHarnessBlockers` so the two views cannot prescribe different
  repairs.
- Reject legacy gate-decision fields at the delivery-run reader and derive
  waiver and ledger codes from the schema-v2 blocker envelope.
- Keep remediation commands as argument arrays and put explanatory work that is
  not directly executable in `manual_action` or `code_change` remediations.
- Run the inventory sensor in `scripts/harness-blocker-inventory.ts` when adding
  or changing a package-script-reachable harness command. Its allowlist is an
  explicit migration boundary, not permission for new unstructured blockers.

## What Review Caught, And The Rule It Produced

The first implementation of this contract passed its own tests while three of
its stated guarantees did not hold. Each failure has the same shape, and it is
the durable lesson: **a guarantee that lives beside the constructor instead of
inside it is documentation, not enforcement.**

- Sanitization was applied in `createHarnessInternalErrorBlocker` only.
  `createHarnessBlocker` validated its input and returned it unmodified, so
  the ~30 ordinary call sites - including the wrappers that funnel raw
  exception text into `details` - bypassed redaction entirely. Fix: the
  constructor returns a normalized copy. If every value must satisfy a
  property, the single function every value passes through has to impose it.
- The renderer appended remediation last and then truncated the whole string,
  so the guidance was the first thing lost under pressure. Fix: guidance claims
  its budget before the diagnostic body. When output is bounded, decide
  explicitly what survives; "truncate the end" is a decision by default.
- The enforcement sensor discovered CLIs by the `harness-` filename prefix, so
  `scripts/pr-athena-delivery-run.ts` - the delivery spine - was outside the
  contract while the sensor reported no findings. Fix: registration is the
  mechanism and discovery is the alarm on top of it. A sensor keyed on a naming
  convention measures the convention, not the boundary.

A second review pass added the sharpest version of the same lesson: the guard
added for the third point above *itself* failed this way. Divergent remediation
ids threw from inside the renderer, which the CLI boundary calls from within
its own catch handler - so the check meant to protect guidance destroyed all of
it and left a bare stack. **Enforcement must not run inside the failure path it
protects.** Rendering is now total and lossless, and the invariant moved to the
static inventory sensor, where failing loudly costs nothing.

A later round produced the same lesson in a third form. Two blocked exits
built a typed blocker, persisted it into the decision event, and then never
rendered it - the command exited non-zero with a silent terminal. **Constructing
a blocker is not the same as delivering one**; the persisted envelope and the
operator's screen are two obligations, and satisfying one says nothing about the
other. Relatedly, a command may only suppress the shared fallback blocker if it
emits a conformant one itself. Four commands suppressed it on the grounds that
they print their own report, but those reports were prose with no code, source,
or remediation, so the migration left them worse than it found them.

The suppression flag is where those two obligations come apart, and it caught
the same delivery twice: four commands opted out of the shared fallback while
printing prose that carried no code, source, or remediation, and then the
delivery spine did it again. `renderNonZero: false` is a claim that the command
renders its own conformant blocker, and nothing checked that claim
(V26-1279 closes it).

Two smaller rules fell out of the same pass. Expected policy failures must not
be thrown as bare `Error`s: the CLI boundary maps any unrecognized throw to
`harness_internal_error`, which replaces real remediation with generic
reproduce-and-inspect guidance - exactly the regression this note originally
argued against. And a remediation id is a claim that two blockers need the
*same* repair, because the renderer prints it once; reusing an id for different
guidance now fails loudly rather than silently keeping whichever phrasing was
seen first.
