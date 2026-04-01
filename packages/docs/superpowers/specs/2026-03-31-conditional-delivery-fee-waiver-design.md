# Conditional Delivery Fee Waiver — Minimum Order Amount

**Date:** 2026-03-31
**Status:** Approved

## Overview

Extend the existing delivery fee waiver system to support a minimum order amount threshold. When configured by the admin, delivery fees are only waived if the customer's cart subtotal (before discounts) meets the threshold. This applies globally across all waived regions.

## Background

Currently, the admin can toggle delivery fee waivers per-region (within Accra, other regions, international) or globally. These are unconditional — when enabled, the fee is always waived. The new feature adds an optional monetary threshold: the waiver only activates when the cart subtotal is at or above the configured amount.

## Design Decisions

- **Subtotal before discounts** is used for threshold comparison. This avoids a confusing UX where applying a discount code removes the free delivery benefit.
- **Single global threshold** applies to all waived regions equally (no per-region thresholds).
- **Threshold is an additional condition on existing waivers** — it only applies to regions where the waiver toggle is ON. Regions with waivers OFF always charge the delivery fee regardless of cart amount.
- **Optional/backward-compatible** — if the threshold is not set (undefined, null, or 0), behavior is identical to today (unconditional waiver). When `waiveDeliveryFees` is `boolean` (legacy format), there is no object to attach `minimumOrderAmount` to, so `boolean: true` always means unconditional waiver with no threshold.
- **Frontend-evaluated** (Approach A) — follows the existing trust model where the storefront evaluates config and sends `deliveryFee: 0` or the fee amount. No backend validation changes needed.

## Data Model

Add `minimumOrderAmount` to `StoreWaiveDeliveryFeesConfig` in `athena-webapp/types.ts`:

```typescript
export type StoreWaiveDeliveryFeesConfig =
  | boolean
  | {
      all?: boolean;
      international?: boolean;
      otherRegions?: boolean;
      withinAccra?: boolean;
      minimumOrderAmount?: number; // in store currency units (e.g., 100 = GHS 100)
    };
```

When `minimumOrderAmount` is `undefined`, `null`, or `0`, waivers are unconditional (existing behavior). When set to a positive number, waivers only apply if cart subtotal >= that amount.

### Convex Schema

The Convex store config normalizer at `athena-webapp/convex/inventory/storeConfigV2.ts` may validate the shape of `waiveDeliveryFees`. If so, add `minimumOrderAmount` as an optional number field so the mutation accepts the new field.

## Fee Utility Changes

### `feeUtils.ts`

**`isFeeWaived(waiveDeliveryFees, deliveryOption, subtotal?)`**

Add an optional `subtotal` parameter (in pesewas). After the existing logic determines the region flag is ON:
- If `waiveDeliveryFees` is `boolean: true`, return `true` (no threshold possible — backward compat)
- If `minimumOrderAmount` is set and `subtotal < toPesewas(minimumOrderAmount)`, return `false`
- Otherwise return `true`

**`isAnyFeeWaived(waiveDeliveryFees, subtotal?)`**

Add an optional `subtotal` parameter (in pesewas). If any region flag is ON but `minimumOrderAmount` is set and `subtotal < threshold`, return `false`. UI indicators (e.g., "free delivery" badges) should only display when the customer's cart actually qualifies.

**New: `hasWaiverConfigured(waiveDeliveryFees, deliveryOption)`**

A new helper that checks whether a waiver is *configured* for the given delivery option, ignoring the threshold. This is needed by the "add more for free delivery" nudge — it needs to know if a waiver exists even when the subtotal doesn't yet meet the threshold. Returns `true` if the region flag is ON regardless of `minimumOrderAmount`.

### `deliveryFees.ts`

**Prerequisite refactor:** The current `calculateDeliveryFee()` has inline waiver logic for Ghana regions (lines 70-76) that bypasses `isFeeWaived()` — only international calls `isFeeWaived()`. Refactor all three region cases (within-accra, outside-accra, intl) to use `isFeeWaived()` so the threshold logic is centralized.

**`calculateDeliveryFee()`** — Add optional `subtotal` parameter to `CalculateDeliveryFeeInput`. After the refactor above, all regions call `isFeeWaived()` which handles the threshold check. The threshold comparison converts `minimumOrderAmount` to pesewas for an apples-to-apples check.

## Storefront Checkout Integration

### CheckoutProvider.tsx

All call sites that invoke `calculateDeliveryFee()`, `isFeeWaived()`, or `isAnyFeeWaived()` must pass the current bag subtotal. The subtotal is computed from bag items:

```typescript
const subtotal = bag?.items?.reduce(
  (sum, item) => sum + toPesewas(item.price) * item.quantity, 0
) || 0;
```

**Specific call sites requiring changes:**

1. **`updateState()` (lines 234-283)** — Currently calls `isAnyFeeWaived(waiveDeliveryFees)` and auto-sets `deliveryFee: 0` when method is delivery and fee is null. Must pass `subtotal` and only auto-zero when the threshold is actually met.
2. **`canPlaceOrder()` (lines 297-303)** — Same pattern: sets `deliveryFee: 0` based solely on `waiveDeliveryFees` being truthy. Must include threshold check.
3. **The `useEffect` that pre-calculates delivery fee from saved user address (lines 196-202)** — Pass subtotal to `calculateDeliveryFee()`.

### DeliveryDetailsSection.tsx

There are **three separate locations** with inline waiver logic that all need updating:

1. **Mobile region `<select>` onChange handler (~line 146-155)** — Inline `shouldWaiveRegionFee` calculation
2. **Desktop region `<Select>` onValueChange handler (~line 211-220)** — Duplicate inline waiver logic
3. **Country change `useEffect` (~line 810-816)** — International fee waiver logic

**Recommended approach:** Replace all three inline waiver calculations with calls to `calculateDeliveryFee()`, passing the subtotal. This centralizes the logic and prevents drift.

### Reactivity

When the bag changes (items added/removed), the checkout state already re-renders. The subtotal-based threshold check naturally re-evaluates since it reads from bag state.

## "Add more to get free delivery" Nudge

A helper function computes the remaining amount needed:

```typescript
const getRemainingForFreeDelivery = (
  waiveDeliveryFees, deliveryOption, subtotal
) => {
  // If no delivery option selected -> return null
  // If region waiver is OFF (use hasWaiverConfigured) -> return null (no free delivery available)
  // If no minimumOrderAmount -> return null (already free, no threshold)
  // If subtotal >= toPesewas(minimumOrderAmount) -> return null (already qualifies)
  // Otherwise -> return toPesewas(minimumOrderAmount) - subtotal (the gap, in pesewas)
};
```

Displayed in the order summary / checkout sidebar near the delivery fee line item. Uses the store's currency formatter. Message format: "Add GHS 20 more to get free delivery". Only shown when:
- A delivery option is selected
- The selected delivery region has a waiver configured
- A `minimumOrderAmount` threshold exists
- The subtotal is below the threshold

## Admin UI Changes

### FeesView.tsx

A single "Minimum order amount for free delivery" input field:
- Only appears when at least one waiver toggle is ON
- Sits below the per-region toggles and above the "Save" button
- Uses the store's currency label (e.g., "GHS")
- Accepts a whole number input (uses `parseInt`, consistent with existing fee inputs), minimum value 0
- Negative numbers are rejected/ignored
- Stored as `minimumOrderAmount` on the `waiveDeliveryFees` config object
- When empty or 0, waivers are unconditional (backward compatible)
- Helper text: "Leave empty for unconditional free delivery"

The value is saved alongside the existing waiver config in `handleUpdateFees()`.

## Testing

### feeUtils.test.ts

- `isFeeWaived()` returns `true` when region waiver is ON and subtotal >= threshold
- `isFeeWaived()` returns `false` when region waiver is ON but subtotal < threshold
- `isFeeWaived()` returns `true` when region waiver is ON and no threshold set (backward compat)
- `isFeeWaived()` returns `true` when `waiveDeliveryFees` is `boolean: true` with any subtotal (legacy backward compat)
- `isAnyFeeWaived()` returns `false` when waivers exist but subtotal is below threshold
- `isAnyFeeWaived()` returns `true` when no threshold is set
- `hasWaiverConfigured()` returns `true` when region flag is ON regardless of threshold

### deliveryFees.test.ts

- `calculateDeliveryFee()` returns full fee when waiver is ON but subtotal below threshold
- `calculateDeliveryFee()` returns 0 when waiver is ON and subtotal meets threshold
- `calculateDeliveryFee()` returns 0 for all Ghana regions when using refactored `isFeeWaived()` path (regression)

## Files Affected

| File | Change |
|------|--------|
| `athena-webapp/types.ts` | Add `minimumOrderAmount` to `StoreWaiveDeliveryFeesConfig` |
| `athena-webapp/convex/inventory/storeConfigV2.ts` | Add `minimumOrderAmount` to Convex schema if validated |
| `storefront-webapp/src/lib/feeUtils.ts` | Add `subtotal` param to `isFeeWaived()` and `isAnyFeeWaived()`; add `hasWaiverConfigured()` |
| `storefront-webapp/src/lib/feeUtils.test.ts` | New threshold and legacy backward-compat test cases |
| `storefront-webapp/src/components/checkout/deliveryFees.ts` | Refactor inline Ghana waiver logic to use `isFeeWaived()`; add `subtotal` param |
| `storefront-webapp/src/components/checkout/deliveryFees.test.ts` | New threshold test cases + regression tests for refactored Ghana logic |
| `storefront-webapp/src/components/checkout/CheckoutProvider.tsx` | Pass subtotal to fee functions; fix auto-zero-fee in `updateState()` and `canPlaceOrder()` |
| `storefront-webapp/src/components/checkout/DeliveryDetailsSection.tsx` | Replace 3 inline waiver locations with `calculateDeliveryFee()` calls, passing subtotal |
| `storefront-webapp/src/components/checkout/OrderDetails/index.tsx` | Add "add more for free delivery" nudge |
| `athena-webapp/src/components/store-configuration/components/FeesView.tsx` | Add minimum amount input field |
