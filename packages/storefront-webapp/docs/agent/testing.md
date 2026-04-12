# Storefront Webapp Testing

Use the repo-root harness commands together:

- `bun run harness:check` validates the docs themselves: required files, links, path references, and documented test commands.
- `bun run harness:review` is the touched-file pass. It always runs `bun run harness:check` first, then uses the machine-readable [validation map](./validation-map.json) to decide whether `@athena/storefront-webapp` baseline validations should run for the files you changed.
- `bun run harness:audit` is the full-app pass. It scans the current `storefront-webapp` surface even when nothing is touched and fails on stale harness docs, stale validation-map paths, or live surfaces that the validation map does not cover yet.
- `bun run harness:behavior --scenario <name>` runs shared runtime behavior scenarios that boot app processes, wait for readiness, drive browser interactions, assert runtime signals, and clean up automatically.
- `bun run harness:behavior --scenario <name> --record-video` captures browser-flow evidence for handoff under `artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

- [Test index](./test-index.md)
- [Validation guide](./validation-guide.md)

If `bun run harness:review` reports a coverage gap, the touched `packages/storefront-webapp` file is not represented in the validation map yet. Update the map and this testing guide together before handoff so the harness stays honest.

If `bun run harness:audit` reports a coverage gap, a live `src/` or `tests/` surface exists without a corresponding validation-map entry. Add or tighten the affected surface mapping before handoff so future agents can trust the repo-wide scan.

Use `bun run harness:behavior --list` to inspect available runtime scenarios.
Current shared scenarios include:
- `sample-runtime-smoke` (shared contract smoke check)
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`
- `storefront-checkout-bootstrap`
- `storefront-checkout-validation-blocker`
- `storefront-checkout-verification-recovery`

Start with the package suite in [vitest.config.ts](../../vitest.config.ts): `bun run --filter '@athena/storefront-webapp' test`. It is the default regression pass for API wrappers, route helpers, checkout state, and shared utility logic.

Escalate validation based on the surface you touched:

- Checkout flows: target [src/components/checkout/deliveryFees.test.ts](../../src/components/checkout/deliveryFees.test.ts), [src/components/checkout/deriveCheckoutState.test.ts](../../src/components/checkout/deriveCheckoutState.test.ts), and [src/api/checkoutSession.test.ts](../../src/api/checkoutSession.test.ts).
- Checkout/auth route-boundary changes: run `bun run --filter '@athena/storefront-webapp' lint:architecture` to catch lower-layer imports that reach back into checkout or auth route entrypoints.
- Store config or observability changes: target [src/lib/storeConfig.test.ts](../../src/lib/storeConfig.test.ts), [src/lib/storefrontObservability.test.ts](../../src/lib/storefrontObservability.test.ts), and [src/lib/storefrontJourneyEvents.test.ts](../../src/lib/storefrontJourneyEvents.test.ts).
- Type or router changes: run `bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json` or `bun run --filter '@athena/storefront-webapp' build`.
- Full browser journeys, navigation, or payment redirects: run `bun run --filter '@athena/storefront-webapp' test:e2e` against the Playwright suite under [tests/e2e](../../tests/e2e) with the setup in [playwright.config.ts](../../playwright.config.ts).

This package exposes a scoped architecture lint command in [package.json](../../package.json) for the checkout/auth hot paths; use it when you need lint coverage for those route boundaries instead of assuming the broader package test suite will catch import-direction regressions.
