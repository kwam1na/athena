import type {
  PosCartLineInput,
  PosMoneyTotals,
  PosProductCartLineInput,
  PosServiceCartLineInput,
} from "./types";

export function calculatePosCartTotals(
  items: PosCartLineInput[],
  taxRate: number = 0,
): PosMoneyTotals {
  if (!items.length) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
    };
  }

  const subtotal = items.reduce((sum, item) => {
    assertValidPosCartLine(item);

    return sum + calculatePosCartLineSubtotal(item);
  }, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  return {
    subtotal: roundPosAmount(subtotal),
    tax: roundPosAmount(tax),
    total: roundPosAmount(total),
  };
}

export function calculatePosItemTotal(price: number, quantity: number): number {
  return roundPosAmount(price * quantity);
}

export function calculatePosCartLineSubtotal(item: PosCartLineInput): number {
  if (isPosServiceCartLine(item)) {
    return getPosEffectivePrice(item.unitPrice) * item.quantity;
  }

  return (
    getPosEffectivePrice(item.price) * item.quantity
  );
}

export function getPosEffectivePrice(price: number): number {
  return price;
}

export function isPosServiceCartLine(
  item: PosCartLineInput,
): item is PosServiceCartLineInput {
  return item.lineKind === "service";
}

export function isPosProductCartLine(
  item: PosCartLineInput,
): item is PosProductCartLineInput {
  return item.lineKind !== "service";
}

export function assertValidPosCartLine(item: PosCartLineInput): void {
  if (!isPosServiceCartLine(item)) {
    return;
  }

  if (!item.displayName.trim()) {
    throw new Error("Service line requires a display name.");
  }

  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new Error("Service line quantity must be greater than zero.");
  }

  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
    throw new Error("Service line price cannot be negative.");
  }
}

function roundPosAmount(amount: number): number {
  return Number(amount.toFixed(2));
}
