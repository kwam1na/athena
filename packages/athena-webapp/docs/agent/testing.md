# Athena Webapp Testing

Use the repo-root harness commands together:

- `bun run harness:check` validates the docs themselves: required files, links, path references, and documented test commands.
- `bun run harness:review` is the touched-file pass. It always runs `bun run harness:check` first, then uses the machine-readable [validation map](./validation-map.json) to decide whether `@athena/webapp` baseline validations and mapped runtime behavior scenarios should run for the files you changed.
- `bun run harness:audit` is the full-app pass. It scans the current `athena-webapp` surface even when nothing is touched and fails on stale harness docs, stale validation-map paths, or live surfaces that the validation map does not cover yet.
- `bun run harness:inferential-review` is the blocking inferential pass. It emits human-readable remediation plus a machine-readable inferential review artifact in the repo-level artifacts directory.
- `bun run harness:behavior --scenario <name>` runs shared runtime behavior scenarios that boot app processes, wait for readiness, drive browser interactions, assert runtime signals, and clean up automatically.
- `bun run harness:behavior --scenario <name> --record-video` captures browser-flow evidence for handoff under `artifacts/harness-behavior/videos/<scenario>/<run-stamp>/`.

Behavior runs emit `[harness:behavior:report]` JSON with per-phase latency and runtime-signal diagnostics. Thresholds are configured per scenario through `runtimeSignals[].minMatches` / `runtimeSignals[].maxMatches` and `thresholds.latency` in [scripts/harness-behavior-scenarios.ts](../../../../scripts/harness-behavior-scenarios.ts).

- [Test index](./test-index.md)
- [Validation guide](./validation-guide.md)

If `bun run harness:review` reports a coverage gap, the touched `packages/athena-webapp` file is not represented in the validation map yet. Update the map (including `behaviorScenarios` when runtime checks are required) and this testing guide together before handoff so the harness stays honest.

If `bun run harness:audit` reports a coverage gap, a live `src/` or `convex/` surface exists without a corresponding validation-map entry. Add or tighten the affected surface mapping before handoff so future agents can trust the repo-wide scan.

If `bun run harness:inferential-review` reports findings, treat them as blocking: the command exits non-zero and includes remediation guidance for each actionable issue. If it reports a provider/runtime error, resolve the error and rerun before handoff.

Use `bun run harness:behavior --list` to inspect available runtime scenarios.
Current shared scenarios include:
- `sample-runtime-smoke` (shared contract smoke check)
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`
- `valkey-proxy-local-request-response`
- `storefront-checkout-bootstrap`
- `storefront-checkout-validation-blocker`
- `storefront-checkout-verification-recovery`

Start with the package suite in [vitest.config.ts](../../vitest.config.ts): `bun run --filter '@athena/webapp' test`. It covers both `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`, so it is the default regression pass for mixed UI and backend changes.

Escalate validation based on the surface you touched:

- Service operations intake, catalog, appointment, case, or manager-queue changes: run `bun run --filter '@athena/webapp' test convex/serviceOps/serviceCases.test.ts convex/serviceOps/catalogAppointments.test.ts convex/serviceOps/moduleWiring.test.ts convex/operations/serviceIntake.test.ts src/components/services/ServiceIntakeView.test.tsx src/components/services/ServiceAppointmentsView.test.tsx src/components/services/ServiceCasesView.test.tsx src/components/services/ServiceCatalogView.test.tsx src/components/operations/OperationsQueueView.test.tsx` before broader package validation.
- New service routes or sidebar wiring: regenerate owned artifacts instead of editing them by hand, then run `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json` and `bun run --filter '@athena/webapp' build`.
- Convex HTTP composition or auth-route changes: run targeted tests like [convex/http/routerComposition.test.ts](../../convex/http/routerComposition.test.ts) and [convex/http/domains/storeFront/routes/security.test.ts](../../convex/http/domains/storeFront/routes/security.test.ts).
- Inventory query or POS behavior changes: spot-check existing guards such as [convex/inventory/posQueryCleanup.test.ts](../../convex/inventory/posQueryCleanup.test.ts) and [src/tests/pos/usePrint.test.ts](../../src/tests/pos/usePrint.test.ts).
- Authenticated admin/store route-boundary changes: run `bun run --filter '@athena/webapp' lint:architecture` to catch lower-layer imports that reach back into `_authed` route or shell entrypoints.
- Any change under `convex/`: run `bun run --filter '@athena/webapp' audit:convex` and `bun run --filter '@athena/webapp' lint:convex:changed` before PR handoff.
- Route, typing, or build-pipeline changes: run `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json` or `bun run --filter '@athena/webapp' build`.

Avoid editing generated files like [src/routeTree.gen.ts](../../src/routeTree.gen.ts) or anything under `convex/_generated`; regenerate instead if a tool owns them.
