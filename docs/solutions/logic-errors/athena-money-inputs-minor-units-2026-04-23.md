---
title: Athena Money Inputs Must Persist Minor Units
date: 2026-04-23
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: payments
symptoms:
  - "Frontend money inputs saved display-unit values into backend fields that expect minor units"
  - "Amounts such as 45.25 could persist where pesewas/minor units were expected"
  - "Money conversion differed across services, cash closeout, promo codes, and store fees"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - money-units
  - minor-units
  - pesewas
  - frontend-forms
  - static-audit
  - convex
---

# Athena Money Inputs Must Persist Minor Units

## Problem

Athena stores monetary values as minor units, but several frontend amount-entry surfaces were sending display units directly to Convex mutations. A staff-entered value like `45.25` could therefore persist as `45.25` instead of `4525`, corrupting balances, discounts, closeout variance, and service payment math.

Percentages are the intentional exception: percentage values stay raw, so `15` remains `15`.

## Symptoms

- UI values looked reasonable while editing, but saved data used the wrong unit scale.
- `Number`, `parseFloat`, or `parseInt` appeared at money save boundaries.
- Service deposits, catalog prices, case quotes/payments, register counted cash, fixed promo discounts, and delivery fees each had slightly different conversion behavior.

Example of the bug pattern:

```ts
// Wrong for money persisted as pesewas/minor units
depositAmount: Number(form.depositAmount)
discountValue: parseFloat(discount)
unitPrice: Number(lineItemForm.unitPrice)
```

## What Didn't Work

- Fixing display formatting alone did not protect persistence. Earlier POS/cash-control work fixed stored pesewas being rendered as giant display amounts, but this bug was the inverse: display units entering persistence (session history).
- Per-form ad hoc fixes were too easy to miss because broad searches for `amount`, `price`, or `currency` were noisy (session history).
- Treating all numeric fields as money was wrong because percentages, quantities, durations, and tax rates keep their raw numeric meaning.

## Solution

Normalize frontend display-money inputs through the shared parser before constructing mutation payloads:

```ts
const amountPesewas = parseDisplayAmountInput(displayValue);
```

The parser in `packages/athena-webapp/src/lib/pos/displayAmounts.ts` now rejects negative values before stripping formatting, so `-12` cannot become `1200`.

The fix covered these boundaries:

- `ServiceIntakeView`: service deposit saves minor units.
- `ServiceCatalogView`: `basePrice` and flat `depositValue` save minor units; percentage deposits remain raw.
- `ServiceCasesView`: quoted amount, payment amount, and line-item `unitPrice` save minor units.
- `RegisterCloseoutView`: counted cash parses display input to minor units and renders stored minor units back as display units for editing.
- Promo codes: `promoCodeMoney` parses fixed amount discounts to minor units, keeps percentage discounts raw, renders stored fixed discounts as display units, and formats promo config payloads consistently.
- `FeesView`: delivery fees preserve decimal values, handle zero intentionally, and convert with `toPesewas`.

Add a regression audit:

```text
packages/athena-webapp/src/lib/moneyEntryAudit.test.ts
```

That test scans Athena frontend source files with the TypeScript AST and forces raw `Number`, `parseFloat`, or `parseInt` money parsing to be reviewed or removed when it appears in a money-entry context. The AST pass catches multiline mutation payloads and pure helper wrappers, so a new surface like `price: toNumber(priceInput)` fails even if the helper hides the raw parse elsewhere in the file.

## Why This Works

The conversion now happens at the UI-to-mutation boundary, where the code still knows whether a field is display money or a raw percentage. After that boundary, Convex and downstream helpers can consistently assume monetary values are minor units.

The static audit makes the bug class visible during tests instead of depending on reviewer memory. It also keeps non-money numeric exceptions explicit, which matters for quantities, durations, tax rates, percentage deposits, and percentage promo discounts.

## Prevention

- Use `parseDisplayAmountInput` for frontend money fields that persist to pesewas/minor units.
- Use `toDisplayAmount` or `formatStoredAmount` when stored minor units are shown or loaded back into editable inputs.
- Keep percentage fields raw and branch by `discountType` or `depositType`.
- Keep `moneyEntryAudit.test.ts` green when adding frontend money-entry code. New money-entry boundaries are scanned automatically; add reviewed exceptions only for display-only formatting, backend-owned conversion boundaries, or legacy surfaces with an explicit reason.
- Trace money changes end to end: frontend field -> mutation payload -> Convex schema/table -> display/readback path.

Prefer this pattern:

```ts
const value =
  discountType === "percentage"
    ? Number.parseFloat(discountInput)
    : parseDisplayAmountInput(discountInput);
```

Avoid this pattern at money persistence boundaries:

```ts
const amount = Number(input);
const amount = parseFloat(input);
const amount = parseInt(input, 10);
```

## Related Issues

- Linear: V26-366, V26-367, V26-368, V26-369, V26-370, V26-371.
- Plan: `docs/plans/2026-04-23-001-fix-athena-money-minor-units-plan.md`.
- Session-history context: prior POS/cash-control display fixes established the invariant that stored money remains pesewas, but this work added the matching input-side guardrail.
