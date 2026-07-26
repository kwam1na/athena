---
title: Storefront design-system normalization without commerce behavior drift
date: 2026-07-26
category: design-patterns
module: storefront-webapp
problem_type: design_pattern
component: frontend_stimulus
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A customer-facing app has partial tokens and copied primitives but no authoritative design-system boundary"
  - "UI normalization must preserve routes, checkout persistence, payments, auth, selectors, and telemetry"
  - "New frontend tooling or validation surfaces must participate in the repository harness"
tags:
  - storefront
  - design-system
  - accessibility
  - storybook
  - harness
  - semantic-tokens
delivery_diff_fingerprint: e16fc2752fdd8aad483276c0997435d1dac6399def1557fd6209798b65909c4a
---

# Storefront design-system normalization without commerce behavior drift

## Problem

The storefront had Tailwind, CSS variables, Radix components, and a large
`components/ui` inventory, but none of them was authoritative. Routes repeated
containers, raw visual values, loading behavior, motion, forms, and overlays.
Normalizing that surface risked silently changing checkout persistence,
payment/provider boundaries, route/search contracts, authentication, selectors,
or telemetry.

## Solution

Use a one-way, package-local system:

```text
doctrine → semantic tokens → accessible primitives → commerce/page patterns → routes
                                 ↘ Storybook + automated policy
```

Reuse Athena's governance model, not its operator-specific values or shell.
Freeze nonvisual behavior in a route contract matrix before visual migration.
Then migrate in dependency order:

1. Light-first semantic tokens, scalable viewport, focus, and reduced motion.
2. Storybook and changed-file policy enforcement.
3. Action, form, overlay, state, feedback, and media primitives.
4. Declarative shell and shared page composition.
5. Catalog/product, then bag/checkout, then account/post-purchase journeys.
6. Import-proven cleanup and a machine-readable supported-component catalog.

Keep primitives free of route, product, query, API, analytics, and feature
context dependencies. Put feature-owned modal content beside its consumer.
Retain legacy token aliases only as a measured migration bridge, and block new
uses with policy.

When the workbench or policy introduces new package scripts and touched paths,
update all harness authorities together:

- `scripts/harness-app-registry.ts`
- `scripts/harness-app-registry.test.ts`
- the harness audit fixture's package scripts and representative files
- generated package `validation-map.json` and validation docs via
  `bun run harness:generate`

The audit fixture must contain every mapped path and every script referenced by
generated validation docs. Otherwise merge preflight correctly treats the
mapping as stale.

## Why This Matters

The dependency direction makes UI quality enforceable without moving commerce
authority into the design system. Route and feature code still owns pricing,
inventory, checkout schemas, payment gates, redirects, auth, and telemetry;
the system owns semantic presentation and interaction contracts.

The harness coordination rule is equally important. Adding a Storybook command
to the registry without updating its fixture can make generated docs valid in
the real package but impossible to generate in contract tests. Treat registry,
fixture, sibling test, and generated maps as one change.

## Prevention

- Capture route states, selectors, persistence, redirects, telemetry, and
  synthetic evidence rules before changing presentation.
- Require visible focus, true loading/disabled behavior, accessible names,
  focus restoration, scalable zoom/reflow, and reduced-motion behavior in
  primitive and journey tests.
- Run both changed-file and whole-tree design policy checks; the former blocks
  regression while the latter measures residual migration debt.
- Use repository search and build/typecheck proof before deleting copied UI or
  font assets.
- After changing harness scenarios, run `bun run harness:generate` followed by
  `bun run pr:athena:preflight` before the full merge-grade validation.
- Run Graphify after the final code state, then restamp the compound note and
  landed-change report fingerprints after reviewer fixes.

## Examples

Before, a route could introduce a local container and raw state color:

```tsx
<main className="mx-auto max-w-[1024px] px-5 text-red-600">
```

After, route composition and intent are named:

```tsx
<StorefrontPage width="content">
  <InlineAlert tone="danger">We could not complete that step.</InlineAlert>
</StorefrontPage>
```

For a new validation surface, do not update only the runtime registry. Add the
script to the fixture package, create representative fixture paths, update the
sibling assertion, regenerate docs, and run preflight.

## Related

- [Athena primary color token consolidation](./athena-primary-color-token-consolidation-2026-07-17.md)
- [Frontend changed-file lint](../harness/frontend-changed-lint-2026-05-06.md)
- [Storefront normalization plan](../../plans/2026-07-25-001-refactor-storefront-design-system-normalization-plan.md)
