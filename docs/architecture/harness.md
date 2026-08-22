# Agent Delivery Harness Architecture

This page is the visual overview of Athena's repository delivery harness. The
canonical [Repo Harness And Sensors](../harness.md) document owns the detailed
command behavior, gate semantics, generated artifacts, CI wiring, and failure
handling.

## System Overview

![Athena agent delivery harness architecture](./assets/harness-overview.png)

The harness turns a prepared repository candidate into candidate-bound evidence:

1. Repo-local policy and generated navigation guide preparation of the exact
   candidate.
2. The delivery orchestrator sequences the gate lifecycle; it does not
   implement gate policy itself.
3. Contract preflight detects deterministic registry, documentation, fixture,
   and harness drift before expensive validation.
4. Obligation admission decides whether the candidate has enough exact-tree
   evidence, an authorized waiver or delegation, or a valid non-applicability
   result to proceed.
5. Validation providers run the admitted work and record reusable proof for the
   same candidate. Pull-request CI independently enforces the repository
   contracts.

## Ownership Boundary

The delivery orchestrator owns ordering and run state. The registries own
declarative contracts, preflight owns static consistency checks, admission owns
the fail-closed decision, and providers own the validation work they report.
Keeping those responsibilities separate prevents the runner from silently
becoming the policy authority.

Failure presentation is also a shared boundary rather than orchestrator policy.
The source that detects a block constructs a typed `HarnessBlocker`; terminal
and structured-event adapters render that same object. The orchestrator may
aggregate blockers and deduplicate remediation ids, but it does not rewrite
their ownership, cause, or prescribed repair.

## Source Boundaries

- Package and documentation contracts:
  [`harness-app-registry.ts`](../../scripts/harness-app-registry.ts).
- Gate obligations and admission policy:
  [`harness-gate-registry.ts`](../../scripts/harness-gate-registry.ts) and
  [`harness-gate-admission.ts`](../../scripts/harness-gate-admission.ts).
- Typed blockers, remediation tuples, bounded terminal rendering, and versioned
  serialization:
  [`harness-blockers.ts`](../../scripts/harness-blockers.ts).
- Package-script-reachable harness CLI inventory and migration enforcement:
  [`harness-blocker-inventory.ts`](../../scripts/harness-blocker-inventory.ts).
- Static contract checks:
  [`harness-contract-preflight.ts`](../../scripts/harness-contract-preflight.ts).
- Delivery orchestration:
  [`pr-athena-delivery-run.ts`](../../scripts/pr-athena-delivery-run.ts).

## Blocker Flow

1. A registry, sensor, admission evaluator, preparation check, or provider
   identifies a fail-closed condition at its owning boundary.
2. That boundary creates a blocker with a stable code, typed source, sanitized
   diagnostic context, and one or more typed remediations. Executable commands
   remain argument arrays.
3. The orchestrator aggregates blockers without flattening them into prose.
4. The terminal adapter emits bounded human guidance and deduplicates repeated
   remediation ids. The structured adapter emits the same blockers under a
   versioned schema for ledgers and automation. Gate-decision schema v2 makes
   that envelope exclusive: no parallel string finding/remediation projection
   remains.
5. The CLI inventory sensor prevents reachable secondary commands from
   bypassing this path with a new free-form blocker.

## Diagram Source And Export

The editable source is
[`athena-harness-architecture.html`](./athena-harness-architecture.html).
Regenerate all committed architecture images from the repository root with:

```bash
bun run docs:diagrams
```

The exporter waits for web fonts and captures each SVG at 2× device scale so
GitHub renders the intended typography without depending on external fonts in
Markdown.
