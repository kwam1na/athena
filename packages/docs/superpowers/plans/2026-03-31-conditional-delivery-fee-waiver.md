# Conditional Delivery Fee Waiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional minimum order amount threshold to the delivery fee waiver system, so fees are only waived when the cart subtotal meets a configurable amount.

**Architecture:** Extend `StoreWaiveDeliveryFeesConfig` with `minimumOrderAmount`. Propagate a `subtotal` parameter through `isFeeWaived()`, `isAnyFeeWaived()`, and `calculateDeliveryFee()`. Refactor inline waiver logic in `DeliveryDetailsSection.tsx` and `deliveryFees.ts` to use centralized functions. Add admin UI input and storefront nudge message.

**Tech Stack:** TypeScript, React, Vitest, Convex

**Spec:** `docs/superpowers/specs/2026-03-31-conditional-delivery-fee-waiver-design.md`

---

### Task 1: Update type definitions and Convex normalizer

**Files:**
- Modify: `athena-webapp/types.ts:130-137`
- Modify: `athena-webapp/convex/inventory/storeConfigV2.ts:127-142`

- [ ] **Step 1: Add `minimumOrderAmount` to `StoreWaiveDeliveryFeesConfig`**

In `athena-webapp/types.ts`, add the field to the object branch of the union:

```typescript
export type StoreWaiveDeliveryFeesConfig =
  | boolean
  | {
      all?: boolean;
      international?: boolean;
      otherRegions?: boolean;
      withinAccra?: boolean;
      minimumOrderAmount?: number;
    };
```

- [ ] **Step 2: Update Convex normalizer to preserve `minimumOrderAmount`**

In `athena-webapp/convex/inventory/storeConfigV2.ts`, update `normalizeWaiveDeliveryFees` to include the new field:

```typescript
const normalizeWaiveDeliveryFees = (
  value: unknown,
): StoreWaiveDeliveryFeesConfig => {
  if (typeof value === "boolean") {
    return value;
  }

  const record = asRecord(value);

  return {
    all: asBoolean(record.all),
    international: asBoolean(record.international),
    otherRegions: asBoolean(record.otherRegions),
    withinAccra: asBoolean(record.withinAccra),
    minimumOrderAmount: asNumber(record.minimumOrderAmount),
  };
};
```

- [ ] **Step 3: Commit**

```bash
git add athena-webapp/types.ts athena-webapp/convex/inventory/storeConfigV2.ts
git commit -m "feat: add minimumOrderAmount to delivery fee waiver config type and normalizer"
```

---

### Task 2: Add threshold support to `feeUtils.ts` (TDD)

**Files:**
- Modify: `storefront-webapp/src/lib/feeUtils.ts`
- Modify: `storefront-webapp/src/lib/feeUtils.test.ts`

- [ ] **Step 1: Write failing tests for `isFeeWaived` with subtotal**

Add these tests to `storefront-webapp/src/lib/feeUtils.test.ts`:

```typescript
describe("isFeeWaived with minimumOrderAmount", () => {
  it("returns true when region waiver is ON and subtotal >= threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    // subtotal is in pesewas: 100 GHS = 10000 pesewas
    expect(isFeeWaived(config, "within-accra", 10000)).toBe(true);
  });

  it("returns false when region waiver is ON but subtotal < threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(false);
  });

  it("returns true when region waiver is ON and no threshold set (backward compat)", () => {
    const config = { withinAccra: true };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(true);
  });

  it("returns true when waiveDeliveryFees is boolean true regardless of subtotal", () => {
    expect(isFeeWaived(true, "within-accra", 100)).toBe(true);
    expect(isFeeWaived(true, "intl", 0)).toBe(true);
  });

  it("returns true when threshold is 0 (treated as no threshold)", () => {
    const config = { withinAccra: true, minimumOrderAmount: 0 };
    expect(isFeeWaived(config, "within-accra", 0)).toBe(true);
  });

  it("returns true when all is true and subtotal >= threshold", () => {
    const config = { all: true, minimumOrderAmount: 50 };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(true);
  });

  it("returns false when all is true but subtotal < threshold", () => {
    const config = { all: true, minimumOrderAmount: 50 };
    expect(isFeeWaived(config, "within-accra", 1000)).toBe(false);
  });

  it("returns false when region waiver is OFF regardless of subtotal", () => {
    const config = { withinAccra: false, minimumOrderAmount: 10 };
    expect(isFeeWaived(config, "within-accra", 99999)).toBe(false);
  });

  it("returns true when subtotal is not provided and no threshold (backward compat)", () => {
    const config = { withinAccra: true };
    expect(isFeeWaived(config, "within-accra")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: FAIL — `isFeeWaived` does not accept a third parameter / does not check threshold.

- [ ] **Step 3: Update `isFeeWaived` to support subtotal threshold**

Update the type and function in `storefront-webapp/src/lib/feeUtils.ts`. The `WaiveDeliveryFeesConfig` type used inline needs `minimumOrderAmount`. Add `subtotal` as an optional third parameter. After the existing logic determines the region flag is ON, check the threshold before returning `true`:

```typescript
type DeliveryOption = "within-accra" | "outside-accra" | "intl";

type WaiveDeliveryFeesConfig =
  | boolean
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
      minimumOrderAmount?: number;
    }
  | undefined
  | null;

// Helper: check threshold. Returns true if waiver should proceed.
// minimumOrderAmount is in store currency, subtotal is in pesewas.
// When subtotal is undefined, returns true for backward compatibility —
// existing callers that don't pass subtotal still get unconditional waivers.
const meetsThreshold = (
  minimumOrderAmount: number | undefined,
  subtotal: number | undefined
): boolean => {
  if (!minimumOrderAmount || minimumOrderAmount <= 0) return true;
  if (subtotal === undefined) return true;
  return subtotal >= minimumOrderAmount * 100; // toPesewas
};

export const isFeeWaived = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null,
  subtotal?: number
): boolean => {
  if (typeof waiveDeliveryFees === "boolean") {
    return waiveDeliveryFees;
  }

  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  if (waiveDeliveryFees.all) {
    return meetsThreshold(waiveDeliveryFees.minimumOrderAmount, subtotal);
  }

  if (!deliveryOption) {
    return false;
  }

  let regionWaived = false;
  if (deliveryOption === "within-accra") {
    regionWaived = !!waiveDeliveryFees.withinAccra;
  } else if (deliveryOption === "outside-accra") {
    regionWaived = !!waiveDeliveryFees.otherRegions;
  } else if (deliveryOption === "intl") {
    regionWaived = !!waiveDeliveryFees.international;
  }

  if (!regionWaived) return false;

  return meetsThreshold(waiveDeliveryFees.minimumOrderAmount, subtotal);
};
```

- [ ] **Step 4: Run tests to verify `isFeeWaived` tests pass**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: All `isFeeWaived` tests PASS.

- [ ] **Step 5: Write failing tests for `isAnyFeeWaived` with subtotal**

Add to `storefront-webapp/src/lib/feeUtils.test.ts`:

```typescript
describe("isAnyFeeWaived with minimumOrderAmount", () => {
  it("returns false when waivers exist but subtotal is below threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isAnyFeeWaived(config, 5000)).toBe(false);
  });

  it("returns true when waivers exist and subtotal meets threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isAnyFeeWaived(config, 10000)).toBe(true);
  });

  it("returns true when no threshold is set", () => {
    const config = { withinAccra: true };
    expect(isAnyFeeWaived(config, 5000)).toBe(true);
  });

  it("returns true for legacy boolean true regardless of subtotal", () => {
    expect(isAnyFeeWaived(true, 0)).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: FAIL — `isAnyFeeWaived` does not accept a second parameter.

- [ ] **Step 7: Update `isAnyFeeWaived` to support subtotal threshold**

Update in `storefront-webapp/src/lib/feeUtils.ts`:

```typescript
export const isAnyFeeWaived = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  subtotal?: number
): boolean => {
  if (typeof waiveDeliveryFees === "boolean") {
    return waiveDeliveryFees;
  }

  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  const anyRegionWaived = !!(
    waiveDeliveryFees.all ||
    waiveDeliveryFees.withinAccra ||
    waiveDeliveryFees.otherRegions ||
    waiveDeliveryFees.international
  );

  if (!anyRegionWaived) return false;

  return meetsThreshold(waiveDeliveryFees.minimumOrderAmount, subtotal);
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Write failing tests for `hasWaiverConfigured`**

Add to `storefront-webapp/src/lib/feeUtils.test.ts`:

```typescript
import { isFeeWaived, isAnyFeeWaived, hasWaiverConfigured } from "./feeUtils";

describe("hasWaiverConfigured", () => {
  it("returns true when region flag is ON regardless of threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 9999 };
    expect(hasWaiverConfigured(config, "within-accra")).toBe(true);
  });

  it("returns false when region flag is OFF", () => {
    const config = { withinAccra: false, minimumOrderAmount: 10 };
    expect(hasWaiverConfigured(config, "within-accra")).toBe(false);
  });

  it("returns true when all is true", () => {
    const config = { all: true, minimumOrderAmount: 9999 };
    expect(hasWaiverConfigured(config, "intl")).toBe(true);
  });

  it("returns true for legacy boolean true", () => {
    expect(hasWaiverConfigured(true, "within-accra")).toBe(true);
  });

  it("returns false for legacy boolean false", () => {
    expect(hasWaiverConfigured(false, "within-accra")).toBe(false);
  });

  it("returns false for undefined/null", () => {
    expect(hasWaiverConfigured(undefined, "within-accra")).toBe(false);
    expect(hasWaiverConfigured(null, "within-accra")).toBe(false);
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: FAIL — `hasWaiverConfigured` does not exist.

- [ ] **Step 11: Implement `hasWaiverConfigured`**

Add to `storefront-webapp/src/lib/feeUtils.ts`:

```typescript
export const hasWaiverConfigured = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null
): boolean => {
  if (typeof waiveDeliveryFees === "boolean") {
    return waiveDeliveryFees;
  }

  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") {
    return false;
  }

  if (waiveDeliveryFees.all) return true;

  if (!deliveryOption) return false;

  if (deliveryOption === "within-accra") return !!waiveDeliveryFees.withinAccra;
  if (deliveryOption === "outside-accra") return !!waiveDeliveryFees.otherRegions;
  if (deliveryOption === "intl") return !!waiveDeliveryFees.international;

  return false;
};
```

- [ ] **Step 12: Write failing test for `getRemainingForFreeDelivery`**

Add to `storefront-webapp/src/lib/feeUtils.test.ts`:

```typescript
import { isFeeWaived, isAnyFeeWaived, hasWaiverConfigured, getRemainingForFreeDelivery } from "./feeUtils";

describe("getRemainingForFreeDelivery", () => {
  it("returns remaining pesewas when subtotal is below threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    // 5000 pesewas = 50 GHS, threshold = 100 GHS = 10000 pesewas
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBe(5000);
  });

  it("returns null when subtotal meets threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, "within-accra", 10000)).toBeNull();
  });

  it("returns null when no threshold is set (already free)", () => {
    const config = { withinAccra: true };
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBeNull();
  });

  it("returns null when region waiver is OFF", () => {
    const config = { withinAccra: false, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBeNull();
  });

  it("returns null when no delivery option selected", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, null, 5000)).toBeNull();
  });

  it("returns null for legacy boolean true (no threshold possible)", () => {
    expect(getRemainingForFreeDelivery(true, "within-accra", 100)).toBeNull();
  });
});
```

- [ ] **Step 13: Implement `getRemainingForFreeDelivery`**

Add to `storefront-webapp/src/lib/feeUtils.ts`:

```typescript
export const getRemainingForFreeDelivery = (
  waiveDeliveryFees: WaiveDeliveryFeesConfig,
  deliveryOption: DeliveryOption | null,
  subtotal: number
): number | null => {
  if (!deliveryOption) return null;
  if (!hasWaiverConfigured(waiveDeliveryFees, deliveryOption)) return null;

  if (typeof waiveDeliveryFees === "boolean") return null;
  if (!waiveDeliveryFees || typeof waiveDeliveryFees !== "object") return null;

  const { minimumOrderAmount } = waiveDeliveryFees;
  if (!minimumOrderAmount || minimumOrderAmount <= 0) return null;

  const thresholdInPesewas = minimumOrderAmount * 100;
  if (subtotal >= thresholdInPesewas) return null;

  return thresholdInPesewas - subtotal;
};
```

- [ ] **Step 14: Run all feeUtils tests**

Run: `cd storefront-webapp && npx vitest run src/lib/feeUtils.test.ts`
Expected: All tests PASS.

- [ ] **Step 15: Commit**

```bash
git add storefront-webapp/src/lib/feeUtils.ts storefront-webapp/src/lib/feeUtils.test.ts
git commit -m "feat: add minimumOrderAmount threshold to fee waiver utilities"
```

---

### Task 3: Refactor `deliveryFees.ts` to use centralized `isFeeWaived()` and add subtotal (TDD)

**Files:**
- Modify: `storefront-webapp/src/components/checkout/deliveryFees.ts`
- Modify: `storefront-webapp/src/components/checkout/deliveryFees.test.ts`

- [ ] **Step 1: Run existing tests to establish green baseline**

Run: `cd storefront-webapp && npx vitest run src/components/checkout/deliveryFees.test.ts`
Expected: All 11 existing tests PASS.

- [ ] **Step 2: Write failing tests for threshold behavior**

Add to `storefront-webapp/src/components/checkout/deliveryFees.test.ts`:

```typescript
describe("calculateDeliveryFee with minimumOrderAmount threshold", () => {
  it("waives fee when waiver is ON and subtotal meets threshold", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true, minimumOrderAmount: 100 },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
      subtotal: 10000, // 100 GHS in pesewas
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "within-accra",
    });
  });

  it("charges fee when waiver is ON but subtotal below threshold", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true, minimumOrderAmount: 100 },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
      subtotal: 5000, // 50 GHS in pesewas
    });

    expect(result).toEqual({
      deliveryFee: 3000,
      deliveryOption: "within-accra",
    });
  });

  it("waives other-regions fee when threshold is met", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "AS",
      waiveDeliveryFees: { otherRegions: true, minimumOrderAmount: 200 },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
      subtotal: 20000,
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "outside-accra",
    });
  });

  it("waives intl fee when threshold is met", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: { international: true, minimumOrderAmount: 500 },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
      subtotal: 50000,
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "intl",
    });
  });

  it("charges intl fee when threshold not met", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: { international: true, minimumOrderAmount: 500 },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
      subtotal: 10000,
    });

    expect(result).toEqual({
      deliveryFee: 80000,
      deliveryOption: "intl",
    });
  });

  it("backward compat: no subtotal param still waives when no threshold", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "within-accra",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify new tests fail**

Run: `cd storefront-webapp && npx vitest run src/components/checkout/deliveryFees.test.ts`
Expected: New tests FAIL (subtotal not in input type, inline logic doesn't check threshold).

- [ ] **Step 4: Refactor `calculateDeliveryFee` to use `isFeeWaived()` and accept subtotal**

Replace the contents of `storefront-webapp/src/components/checkout/deliveryFees.ts`:

```typescript
import { isFeeWaived } from "@/lib/feeUtils";
import { toPesewas } from "@/lib/currency";
import { DeliveryMethod, DeliveryOption } from "./types";

type DeliveryFeeConfig = {
  withinAccra?: number;
  otherRegions?: number;
  international?: number;
} | null;

type WaiveDeliveryFees =
  | boolean
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
      minimumOrderAmount?: number;
    }
  | null
  | undefined;

type CalculateDeliveryFeeInput = {
  deliveryMethod: DeliveryMethod;
  country: string;
  region: string | null;
  waiveDeliveryFees: WaiveDeliveryFees;
  deliveryFees: DeliveryFeeConfig;
  subtotal?: number; // in pesewas
};

type CalculateDeliveryFeeResult = {
  deliveryFee: number;
  deliveryOption: DeliveryOption | null;
};

const DEFAULT_WITHIN_ACCRA_FEE = 30;
const DEFAULT_OTHER_REGIONS_FEE = 70;
const DEFAULT_INTERNATIONAL_FEE = 800;

export function calculateDeliveryFee({
  deliveryMethod,
  country,
  region,
  waiveDeliveryFees,
  deliveryFees,
  subtotal,
}: CalculateDeliveryFeeInput): CalculateDeliveryFeeResult {
  if (deliveryMethod === "pickup") {
    return { deliveryFee: 0, deliveryOption: null };
  }

  const isGhana = country === "GH";
  const isGreaterAccra = region === "GA";

  let deliveryOption: DeliveryOption;
  let baseFee: number;

  if (isGhana) {
    deliveryOption = isGreaterAccra ? "within-accra" : "outside-accra";
    const withinAccraFee =
      deliveryFees?.withinAccra ?? DEFAULT_WITHIN_ACCRA_FEE;
    const otherRegionsFee =
      deliveryFees?.otherRegions ?? DEFAULT_OTHER_REGIONS_FEE;
    baseFee = isGreaterAccra ? withinAccraFee : otherRegionsFee;
  } else {
    deliveryOption = "intl";
    baseFee = deliveryFees?.international ?? DEFAULT_INTERNATIONAL_FEE;
  }

  const shouldWaive = isFeeWaived(waiveDeliveryFees, deliveryOption, subtotal);

  return {
    deliveryFee: shouldWaive ? 0 : toPesewas(baseFee),
    deliveryOption,
  };
}
```

Key changes:
- Replaced inline Ghana waiver logic (lines 70-76) with `isFeeWaived(waiveDeliveryFees, deliveryOption, subtotal)` — all regions now go through the same centralized function.
- Added `subtotal?: number` to `CalculateDeliveryFeeInput`.
- Added `minimumOrderAmount?: number` to local `WaiveDeliveryFees` type.

- [ ] **Step 5: Run all delivery fee tests**

Run: `cd storefront-webapp && npx vitest run src/components/checkout/deliveryFees.test.ts`
Expected: All tests PASS (both old and new).

- [ ] **Step 6: Commit**

```bash
git add storefront-webapp/src/components/checkout/deliveryFees.ts storefront-webapp/src/components/checkout/deliveryFees.test.ts
git commit -m "feat: refactor deliveryFees to use centralized isFeeWaived and add subtotal threshold"
```

---

### Task 4: Update `CheckoutProvider.tsx` to pass subtotal

**Files:**
- Modify: `storefront-webapp/src/components/checkout/CheckoutProvider.tsx`

- [ ] **Step 1: Compute subtotal from bag and pass through all fee call sites**

In `storefront-webapp/src/components/checkout/CheckoutProvider.tsx`:

1. Import `toPesewas` (already imported).

2. Inside `CheckoutProvider`, compute the subtotal from the bag. Place this after the `bag` destructure (line 83):

```typescript
const bagSubtotalPesewas =
  bag?.items?.reduce(
    (sum: number, item: any) => sum + toPesewas(item.price) * item.quantity,
    0
  ) || 0;
```

3. **Update the user address `useEffect`** (~line 196): pass `subtotal` to `calculateDeliveryFee`:

```typescript
const { deliveryFee, deliveryOption } = calculateDeliveryFee({
  deliveryMethod: "delivery",
  country: country || "",
  region: region || null,
  waiveDeliveryFees,
  deliveryFees,
  subtotal: bagSubtotalPesewas,
});
```

4. **Update `updateState()`** (~line 234-283): pass subtotal to `isAnyFeeWaived` and `isFeeWaived`:

Change line 235:
```typescript
const anyFeeWaived = isAnyFeeWaived(waiveDeliveryFees, bagSubtotalPesewas);
```

Change the international fee recalculation inside `setCheckoutState` (~line 273):
```typescript
const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl", bagSubtotalPesewas);
```

5. **Update `canPlaceOrder()`** (~line 297-303): add threshold check:

```typescript
if (
  isAnyFeeWaived(waiveDeliveryFees, bagSubtotalPesewas) &&
  checkoutState.deliveryMethod === "delivery" &&
  checkoutState.deliveryFee === null
) {
  updateState({ deliveryFee: 0 });
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd storefront-webapp && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add storefront-webapp/src/components/checkout/CheckoutProvider.tsx
git commit -m "feat: pass bag subtotal to fee waiver functions in CheckoutProvider"
```

---

### Task 5: Replace inline waiver logic in `DeliveryDetailsSection.tsx`

**Files:**
- Modify: `storefront-webapp/src/components/checkout/DeliveryDetailsSection.tsx`

- [ ] **Step 1: Add imports and compute subtotal in `RegionFields` component**

In the `RegionFields` component (~line 118), add the `calculateDeliveryFee` import and compute subtotal:

```typescript
import { calculateDeliveryFee } from "./deliveryFees";
import { useShoppingBag } from "@/hooks/useShoppingBag";
```

Inside `RegionFields`:
```typescript
const { bag } = useShoppingBag();
const bagSubtotalPesewas =
  bag?.items?.reduce(
    (sum: number, item: any) => sum + toPesewas(item.price) * item.quantity,
    0
  ) || 0;
```

- [ ] **Step 2: Replace mobile region onChange handler (~lines 146-163)**

Replace the inline `shouldWaiveRegionFee` and fee calculation with:

```typescript
onChange={(e) => {
  const region = e.target.value;

  const { deliveryFee, deliveryOption } = calculateDeliveryFee({
    deliveryMethod: "delivery",
    country: "GH",
    region,
    waiveDeliveryFees,
    deliveryFees,
    subtotal: bagSubtotalPesewas,
  });

  updateState({
    deliveryDetails: {
      ...checkoutState.deliveryDetails,
      region,
      neighborhood:
        deliveryOption == "within-accra"
          ? checkoutState?.deliveryDetails?.neighborhood
          : "",
    } as Address,
    deliveryFee,
    deliveryOption,
  });
  field.onChange(region);
}}
```

- [ ] **Step 3: Replace desktop region onValueChange handler (~lines 211-228)**

Same pattern as Step 2, replace the inline waiver logic:

```typescript
onValueChange={(region) => {
  const { deliveryFee, deliveryOption } = calculateDeliveryFee({
    deliveryMethod: "delivery",
    country: "GH",
    region,
    waiveDeliveryFees,
    deliveryFees,
    subtotal: bagSubtotalPesewas,
  });

  updateState({
    deliveryDetails: {
      ...checkoutState.deliveryDetails,
      region,
      neighborhood:
        deliveryOption == "within-accra"
          ? checkoutState?.deliveryDetails?.neighborhood
          : "",
    } as Address,
    deliveryFee,
    deliveryOption,
  });
  field.onChange(region);
}}
```

- [ ] **Step 4: Update `DeliveryDetailsSection` component country change `useEffect` (~lines 764, 810-816)**

In the `DeliveryDetailsSection` component, compute subtotal and replace the inline fee logic:

```typescript
const { bag } = useShoppingBag();
const bagSubtotalPesewas =
  bag?.items?.reduce(
    (sum: number, item: any) => sum + toPesewas(item.price) * item.quantity,
    0
  ) || 0;

const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl", bagSubtotalPesewas);
```

For the country change `useEffect` (~lines 805-817), replace the inline fee calculation:

```typescript
updateState({
  deliveryDetails: { country } as Address,
  billingDetails: null,
  paymentMethod: "online_payment",
  podPaymentMethod: null,
  ...calculateDeliveryFee({
    deliveryMethod: "delivery",
    country,
    region: country === "GH" ? "GA" : null,
    waiveDeliveryFees,
    deliveryFees,
    subtotal: bagSubtotalPesewas,
  }),
});
```

Note: When country changes to GH, the existing code defaults to `within-accra`. Use `region: "GA"` to match. For non-GH countries, `region: null` produces `intl`.

- [ ] **Step 5: Verify the app builds**

Run: `cd storefront-webapp && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add storefront-webapp/src/components/checkout/DeliveryDetailsSection.tsx
git commit -m "refactor: replace inline waiver logic in DeliveryDetailsSection with calculateDeliveryFee"
```

---

### Task 6: Update `BagSummary.tsx` to pass subtotal and show nudge

**Files:**
- Modify: `storefront-webapp/src/components/checkout/BagSummary.tsx`

- [ ] **Step 1: Update `isFeeWaived` call and add nudge**

In `storefront-webapp/src/components/checkout/BagSummary.tsx`:

1. Update imports:
```typescript
import { isFeeWaived, getRemainingForFreeDelivery } from "@/lib/feeUtils";
import { toPesewas, toDisplayAmount } from "@/lib/currency";
```

2. Compute subtotal in pesewas (after `bagSubtotal` is available, ~line 141). Note: `bagSubtotal` from `useShoppingBag()` is in display currency, so convert:
```typescript
const bagSubtotalPesewas = toPesewas(bagSubtotal);
```

3. Update the `isFeeWaivedForCurrentOption` call (~line 238):
```typescript
const isFeeWaivedForCurrentOption = isFeeWaived(
  waiveDeliveryFees,
  checkoutState.deliveryOption,
  bagSubtotalPesewas
);
```

4. Compute the nudge amount:
```typescript
const remainingForFreeDelivery = getRemainingForFreeDelivery(
  waiveDeliveryFees,
  checkoutState.deliveryOption,
  bagSubtotalPesewas
);
```

5. Add the nudge UI in the summary section, after the delivery fee row (~line 347) and before the discount row:

```tsx
{remainingForFreeDelivery !== null &&
  checkoutState.deliveryMethod === "delivery" && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="text-xs text-accent2"
    >
      <p>
        Add {formatter.format(toDisplayAmount(remainingForFreeDelivery))} more
        to get free delivery
      </p>
    </motion.div>
  )}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd storefront-webapp && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add storefront-webapp/src/components/checkout/BagSummary.tsx
git commit -m "feat: add 'add more for free delivery' nudge in checkout summary"
```

---

### Task 7: Admin UI — add minimum amount input to `FeesView.tsx`

**Files:**
- Modify: `athena-webapp/src/components/store-configuration/components/FeesView.tsx`

- [ ] **Step 1: Add state and sync for `minimumOrderAmount`**

Add a new state variable after the existing waiver states (~line 30):

```typescript
const [minimumOrderAmount, setMinimumOrderAmount] = useState<number | undefined>(undefined);
```

In the `useEffect` that syncs state from store config (~line 61-89), add syncing for the new field inside the object format branch:

```typescript
} else if (waiveConfig && typeof waiveConfig === "object") {
  setWaiveWithinAccraFee(waiveConfig.withinAccra || false);
  setWaiveOtherRegionsFee(waiveConfig.otherRegions || false);
  setWaiveIntlFee(waiveConfig.international || false);
  setMinimumOrderAmount(waiveConfig.minimumOrderAmount || undefined);
} else {
  setWaiveWithinAccraFee(false);
  setWaiveOtherRegionsFee(false);
  setWaiveIntlFee(false);
  setMinimumOrderAmount(undefined);
}
```

- [ ] **Step 2: Include `minimumOrderAmount` in save payload**

Update `handleUpdateFees` (~line 40-46) to include `minimumOrderAmount`:

```typescript
const waiveDeliveryFeesConfig = {
  withinAccra: waiveWithinAccraFee,
  otherRegions: waiveOtherRegionsFee,
  international: waiveIntlFee,
  all: waiveWithinAccraFee && waiveOtherRegionsFee && waiveIntlFee,
  minimumOrderAmount: minimumOrderAmount || undefined,
};
```

- [ ] **Step 3: Add the input field to the UI**

Compute whether any waiver is active:

```typescript
const anyWaiverActive = waiveWithinAccraFee || waiveOtherRegionsFee || waiveIntlFee;
```

Add the minimum order amount input between the "Waive all delivery fees" section and the Save button (~after line 211, before line 214):

```tsx
{anyWaiverActive && (
  <div className="container mx-auto py-4">
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm text-muted-foreground">
          {`Minimum order amount for free delivery (${activeStore?.currency.toUpperCase()})`}
        </Label>
        <Input
          type="number"
          min={0}
          placeholder="Leave empty for unconditional free delivery"
          value={minimumOrderAmount || ""}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            setMinimumOrderAmount(isNaN(val) || val < 0 ? undefined : val);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty for unconditional free delivery
        </p>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify the app builds**

Run: `cd athena-webapp && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add athena-webapp/src/components/store-configuration/components/FeesView.tsx
git commit -m "feat: add minimum order amount input to admin delivery fees config"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run all storefront tests**

Run: `cd storefront-webapp && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Type-check both packages**

Run: `cd storefront-webapp && npx tsc --noEmit`
Run: `cd athena-webapp && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit any remaining fixes if needed**
