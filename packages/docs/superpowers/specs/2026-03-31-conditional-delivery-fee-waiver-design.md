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
- **Optional/backward-compatible** — if the threshold is not set (undefined, null, or 0), behavior is identical to today (unconditional waiver).
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

## Fee Utility Changes

### `feeUtils.ts`

**`isFeeWaived(waiveDeliveryFees, deliveryOption, subtotal?)`**

Add an optional `subtotal` parameter (in pesewas). After the existing logic determines the region flag is ON:
- If `minimumOrderAmount` is set and `subtotal < toPesewas(minimumOrderAmount)`, return `false`
- Otherwise return `true`

**`isAnyFeeWaived(waiveDeliveryFees, subtotal?)`**

Add an optional `subtotal` parameter (in pesewas). If any region flag is ON but `minimumOrderAmount` is set and `subtotal < threshold`, return `false`. UI indicators (e.g., "free delivery" badges) should only display when the customer's cart actually qualifies.

### `deliveryFees.ts`

**`calculateDeliveryFee()`** — Add optional `subtotal` parameter to `CalculateDeliveryFeeInput`. Pass it through to `isFeeWaived()`. The threshold comparison converts `minimumOrderAmount` to pesewas for an apples-to-apples check.

## Storefront Checkout Integration

### CheckoutProvider.tsx

All call sites that invoke `calculateDeliveryFee()`, `isFeeWaived()`, or `isAnyFeeWaived()` must pass the current bag subtotal. The subtotal is computed from bag items:

```typescript
const subtotal = bag?.items?.reduce(
  (sum, item) => sum + toPesewas(item.price) * item.quantity, 0
) || 0;
```

Key call sites:
- `updateState()` — where it calls `isAnyFeeWaived()` and `isFeeWaived()`
- The `useEffect` that pre-calculates delivery fee from saved user address
- `canPlaceOrder()` — where it checks waivers

### DeliveryDetailsSection.tsx

The inline waiver logic for region selection also needs the subtotal for the threshold check.

### Reactivity

When the bag changes (items added/removed), the checkout state already re-renders. The subtotal-based threshold check naturally re-evaluates since it reads from bag state.

## "Add more to get free delivery" Nudge

A helper function computes the remaining amount needed:

```typescript
const getRemainingForFreeDelivery = (
  waiveDeliveryFees, deliveryOption, subtotal
) => {
  // If region waiver is OFF -> return null (no free delivery available)
  // If no minimumOrderAmount -> return null (already free)
  // If subtotal >= threshold -> return null (already qualifies)
  // Otherwise -> return threshold - subtotal (the gap)
};
```

Displayed in the order summary / checkout sidebar near the delivery fee line item. Uses the store's currency formatter. Message format: "Add GHS 20 more to get free delivery". Only shown when the return value is a positive number.

## Admin UI Changes

### FeesView.tsx

A single "Minimum order amount for free delivery" input field:
- Only appears when at least one waiver toggle is ON
- Sits below the per-region toggles and above the "Save" button
- Uses the store's currency label (e.g., "GHS")
- Accepts a number input, stored as `minimumOrderAmount` on the `waiveDeliveryFees` config object
- When empty or 0, waivers are unconditional (backward compatible)
- Helper text: "Leave empty for unconditional free delivery"

The value is saved alongside the existing waiver config in `handleUpdateFees()`.

## Testing

### feeUtils.test.ts

- `isFeeWaived()` returns `true` when region waiver is ON and subtotal >= threshold
- `isFeeWaived()` returns `false` when region waiver is ON but subtotal < threshold
- `isFeeWaived()` returns `true` when region waiver is ON and no threshold set (backward compat)
- `isAnyFeeWaived()` returns `false` when waivers exist but subtotal is below threshold
- `isAnyFeeWaived()` returns `true` when no threshold is set

### deliveryFees.test.ts

- `calculateDeliveryFee()` returns full fee when waiver is ON but subtotal below threshold
- `calculateDeliveryFee()` returns 0 when waiver is ON and subtotal meets threshold

## Files Affected

| File | Change |
|------|--------|
| `athena-webapp/types.ts` | Add `minimumOrderAmount` to `StoreWaiveDeliveryFeesConfig` |
| `storefront-webapp/src/lib/feeUtils.ts` | Add `subtotal` param to `isFeeWaived()` and `isAnyFeeWaived()` |
| `storefront-webapp/src/lib/feeUtils.test.ts` | New threshold test cases |
| `storefront-webapp/src/components/checkout/deliveryFees.ts` | Add `subtotal` param to `calculateDeliveryFee()` |
| `storefront-webapp/src/components/checkout/deliveryFees.test.ts` | New threshold test cases |
| `storefront-webapp/src/components/checkout/CheckoutProvider.tsx` | Pass subtotal to fee functions |
| `storefront-webapp/src/components/checkout/DeliveryDetailsSection.tsx` | Pass subtotal to inline waiver logic |
| `storefront-webapp/src/components/checkout/OrderDetails/index.tsx` | Add "add more for free delivery" nudge |
| `athena-webapp/src/components/store-configuration/components/FeesView.tsx` | Add minimum amount input field |
