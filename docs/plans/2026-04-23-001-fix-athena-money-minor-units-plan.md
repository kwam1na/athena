# fix: Normalize Athena frontend money entries to minor-unit persistence

Date: 2026-04-23

## Goal

Audit every Athena webapp frontend surface where staff enter monetary amounts and make sure persisted backend values are stored as minor units exactly once.

## Scope

- Product/SKU pricing and cost entry.
- POS register cash entries, deposits, closeouts, and payment edits.
- Store delivery and service fee configuration.
- Promo-code fixed-amount discounts.
- Service intake, service catalog, service cases, payments, and line items.
- Return/exchange replacement pricing.
- Legacy asset/store configuration amount paths that are still reachable.

## Decisions

- Frontend inputs continue to accept display units such as `12.50`.
- Frontend mutation arguments that represent money should send minor units unless an existing backend boundary explicitly documents and owns the conversion.
- Shared parsing should use `parseDisplayAmountInput` or the same `toPesewas` conversion pattern, not raw `Number`, `parseFloat`, or `parseInt` at mutation boundaries.
- Percentage fields are not money and remain raw percentage values.
- Durable guardrails should make future raw money parsing visible in tests.

## Implementation Units

1. Add shared money-entry parser guardrails and a static audit.
2. Normalize service-operation monetary writes to minor units.
3. Fix cash-control closeout counted-cash normalization.
4. Characterize and fix fixed-amount promo-code discounts.
5. Audit store fees, returns, and product amount-entry edge cases.
6. Refresh docs, Linear evidence, harness outputs if needed, and graphify artifacts.

## Linear Tracking

- V26-366: Add Athena money-entry parser guardrails and static audit.
- V26-367: Normalize Athena service-operation monetary writes to minor units.
- V26-368: Fix cash-control closeout counted-cash minor-unit normalization.
- V26-369: Characterize and fix fixed-amount promo-code minor-unit discounts.
- V26-370: Audit store fees, returns, and product amount-entry edge cases.
- V26-372: Refresh Athena money-entry docs, harness evidence, and graph artifacts.

## Validation Plan

- Focused Vitest coverage for parsing and each affected UI mutation boundary.
- Convex audit and changed Convex lint for backend behavior changes.
- TypeScript check for the webapp package.
- Package-level test run after the coordinated batch.
- `bun run graphify:rebuild` after code changes.

## Delivery Summary

- Added `parseDisplayAmountInput` coverage for decimals, formatted values, invalid values, and negative values.
- Added a static money-entry audit for known frontend save boundaries.
- Normalized service intake, service catalog, service case quote, service payment, and service line-item money inputs to minor-unit mutation payloads.
- Normalized register closeout counted-cash input to minor units and displayed stored counted cash in major units.
- Added promo-code money helpers so fixed-amount discounts persist as minor units while percentage discounts remain raw percentages.
- Updated store delivery-fee inputs to preserve decimals and handle zero intentionally before converting to minor units.
- Added `docs/solutions/logic-errors/athena-money-inputs-minor-units-2026-04-23.md` to capture the reusable money-entry bug pattern.
- Updated agent-facing docs so future work can find the money-entry contract and `docs/solutions/` store.
- Rebuilt graphify artifacts.

## Validation Results

- Passed: `bun run --filter '@athena/webapp' test -- src/components/promo-codes/promoCodeMoney.test.ts src/lib/moneyEntryAudit.test.ts src/components/services/ServiceIntakeView.test.tsx src/components/services/ServiceCatalogView.test.tsx src/components/services/ServiceCasesView.test.tsx src/components/cash-controls/RegisterCloseoutView.test.tsx`
- Passed: `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- Passed: `bun run --filter '@athena/webapp' audit:convex`
- Passed: `bun run --filter '@athena/webapp' lint:convex:changed`
- Passed: `bun run graphify:rebuild`
- Passed until unrelated app test blocker: `bun run harness:review` refreshed/generated docs successfully, then failed on `src/components/traces/WorkflowTraceView.test.tsx`.
- Blocked by unrelated pre-existing worktree changes: `bun run --filter '@athena/webapp' test` fails in `src/components/traces/WorkflowTraceView.test.tsx` because `NavigateBackButton` calls TanStack router hooks outside a `RouterProvider`.
