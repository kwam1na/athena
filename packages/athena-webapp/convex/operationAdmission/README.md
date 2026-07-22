# Operation admission rail

This directory contains the neutral public-write admission rail described in
`docs/plans/2026-07-21-001-feat-operation-admission-rail-plan.md`.

Current branch state: the first proving mutation,
`operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup`, is
admitted through an operation definition and shared-demo adapter. The remaining
public write mutations are intentionally tracked as exact legacy exemptions in
`migrationInventory.ts` until each follow-up wave receives operation
definitions.

The generic Athena-user auth helper keeps a compatibility
`{ sharedDemoCapability }` parameter while callers migrate, but it no longer
admits shared-demo write capabilities. It only preserves explicit read
allowlists such as `reports.read`; write admission belongs in this directory
and the shared-demo operation adapter.

## Required platform shape

The rail should own these platform concepts:

- `capabilities.ts`: re-exports the Athena-wide platform capability catalog.
  Shared demo consumes the platform catalog; it does not own the catalog.
- `definitions.ts`: code-owned operation declarations with operation id,
  capability, scope, readiness, protected effects, actor adapter coverage, and
  migration mode.
- `publicMutation.ts`: a Convex-handler wrapper that resolves an admitted actor
  before invoking domain logic while preserving direct `mutation({ ... })`
  exports and existing return validators.
- `adapters.ts`: normal Athena-user adapter registration. Actor-specific policy
  belongs in adapters, not the generic core.
- `migrationInventory.ts`: explicit temporary exemptions for public writes that
  are not yet admitted through operation definitions.

Shared demo should adapt through `convex/sharedDemo/operationAdapter.ts`, with
server-owned principal resolution, store/org clamp, restore readiness/epoch
checks, capability allow/deny decisions, protected-effect decisions, and stable
policy denials.

## Legacy cleanup patch plan

Run this cleanup only after the adapter path exists and structural coverage
proves migrated writes no longer depend on helper-only admission.

1. Keep `ATHENA_CAPABILITY_CATALOG`, `AthenaCapability`, and public-write
   classification in `convex/platform/capabilityCatalog.ts`; operationAdmission
   definitions should import that platform catalog rather than moving it back
   under shared demo.
2. Keep shared demo importing the platform catalog and expose only demo-specific
   allowlists/effect policy from `convex/sharedDemo/policy.ts`.
3. Replace each migrated `{ sharedDemoCapability }` callsite with an
   operationAdmission definition and adapter-backed handler context.
4. Keep public read allowlists unchanged. `reports.read` and other read/query
   paths are explicitly out of scope for this cleanup.
5. Keep the temporary `options?: { sharedDemoCapability: ... }` parameter only
   as caller compatibility while unmigrated write groups are converted. Generic
   auth may use it only for explicit read allowlists such as `reports.read`.
6. Do not import `requireSharedDemoCapability` from
   `convex/lib/athenaUserAuth.ts`; capability checks for writes must live in
   the shared-demo operation adapter or domain-specific policy.
7. Keep `convex/lib/athenaUserAuth.test.ts` proving that a shared-demo write
   capability is denied by generic auth and admitted only through
   operationAdmission adapter tests.
8. Retire `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY` and the source-containment
   test in `convex/sharedDemo/policy.test.ts` after
   `operationAdmission/migrationInventory.test.ts` proves every migrated public
   write has a definition or explicit exemption.
9. Keep shared-demo adapter tests for allowed capabilities, denied
   capabilities, simulated effects, denied effects, scope clamp, restore
   readiness, expiry, and provenance.

## Validation

For this cleanup, run the focused sensors first:

```bash
cd packages/athena-webapp
bun run test -- convex/lib/athenaUserAuth.test.ts convex/sharedDemo/policy.test.ts convex/operationAdmission
```

Then run the repo-required Convex and generated-artifact checks:

```bash
bun run --filter '@athena/webapp' audit:convex
bun run --filter '@athena/webapp' lint:convex:changed
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run pre-commit:generated-artifacts
bun run graphify:rebuild
```

Before integration PR mergeability, run `bun run pr:athena` from the repo root.
